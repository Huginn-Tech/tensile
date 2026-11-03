package status

import (
	"os"
	"path/filepath"
	"time"
)

// The collector's word to the API that a new blob is in the store.
//
// The two share nothing but the database and the data directory, and the API
// read the store for a new blob four times a second, so a row the collector
// stored waited up to a quarter of a second to reach the pages. The collector
// now rewrites this file when its fast tick or a pass stored a new blob, after
// that read's payments, and the API, which
// watches the file's directory while a tip stream is open, reads the tip at
// once (observer/api/tipblobs.go).
//
// The file says when and nothing else, and nothing depends on it: a word that
// is lost, or never written, leaves the API's four reads a second, as before.
// Its name does not end in .json, so ReadAll does not take it for a process.
const blobMarkFile = "blob.mark"

// BlobMarkPath is the file under dataDir.
func BlobMarkPath(dataDir string) string {
	return filepath.Join(dataDir, "status", blobMarkFile)
}

// MarkBlob rewrites the file, which is the word.
func MarkBlob(dataDir string) error {
	return os.WriteFile(BlobMarkPath(dataDir), []byte(time.Now().UTC().Format(time.RFC3339Nano)+"\n"), 0o644)
}
