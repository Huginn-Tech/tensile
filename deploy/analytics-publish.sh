#!/usr/bin/env bash
#
# fibre-analytics-publish <network>: put the Analytics job's data file into
# the site. Runs as root, from fibre-analytics@ after each run and from the
# site's drop-in (fibre-site-analytics.conf) when the site starts, because
# the job (a DynamicUser with no way to write anywhere but its own state
# directory) cannot write into the site, which a deploy replaces whole.
#
# The file comes out of a directory the job's user owns, so root takes it
# only as the job could have written it: opened without following a
# symlink, a regular file with no second name (a hard link to a root file
# would otherwise be copied out), at most 64 MiB, and a JSON object. Any
# other is refused and the site keeps the file it has. The copy keeps the
# time the job wrote it, which healthwatch's analytics check reads, is 0644,
# and is renamed into place so a visitor never reads half a file.
#
# ANALYTICS_STATE_ROOT and SITE_BASE move the two directories (the selftest
# points them elsewhere).
set -o errexit -o nounset -o pipefail

net="${1:?network}"
case "$net" in ''|*[!a-z0-9-]*|-*) echo "fibre-analytics-publish: bad network name" >&2; exit 2 ;; esac
src="${ANALYTICS_STATE_ROOT:-/var/lib/fibre-analytics}/$net/data.json"
dst="${SITE_BASE:-/srv/fibre-site}/$net/analytics"

exec python3 -I - "$src" "$dst" <<'PY'
import json, os, stat, sys

src, dst = sys.argv[1], sys.argv[2]
LIMIT = 64 << 20

def refuse(why):
    print("fibre-analytics-publish: %s: %s; the site keeps its file" % (src, why), file=sys.stderr)
    sys.exit(1)

try:
    fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
except FileNotFoundError:
    refuse("no file yet")
except OSError as e:
    refuse("cannot be opened as a plain file (%s)" % e.strerror)
st = os.fstat(fd)
if not stat.S_ISREG(st.st_mode):
    refuse("not a regular file")
if st.st_nlink != 1:
    refuse("has another name (a hard link)")
if st.st_size > LIMIT:
    refuse("larger than 64 MiB")
chunks, n = [], 0
while True:
    b = os.read(fd, 1 << 20)
    if not b:
        break
    n += len(b)
    if n > LIMIT:
        refuse("larger than 64 MiB")
    chunks.append(b)
os.close(fd)
data = b"".join(chunks)
try:
    if not isinstance(json.loads(data), dict):
        refuse("not a JSON object")
except ValueError:
    refuse("not JSON")

try:
    dfd = os.open(dst, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
except OSError as e:
    refuse("the site has no %s (%s)" % (dst, e.strerror))
tmp = "data.json.new"
try:
    os.unlink(tmp, dir_fd=dfd)
except FileNotFoundError:
    pass
out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644, dir_fd=dfd)
try:
    view = memoryview(data)
    while view:
        view = view[os.write(out, view):]
    os.fchmod(out, 0o644)
    os.utime(out, ns=(st.st_atime_ns, st.st_mtime_ns))
    os.fsync(out)
finally:
    os.close(out)
os.rename(tmp, "data.json", src_dir_fd=dfd, dst_dir_fd=dfd)
os.close(dfd)
PY
