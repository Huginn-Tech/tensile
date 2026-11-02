package status

import (
	"os"
	"path/filepath"
	"testing"
)

// The word is a file in the status directory, which ReadAll does not take for
// a process.
func TestBlobMarkIsNoProcess(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "status"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := MarkBlob(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(BlobMarkPath(dir)); err != nil {
		t.Fatal(err)
	}
	reports, err := ReadAll(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(reports) != 0 {
		t.Errorf("ReadAll took the word for a process: %v", reports)
	}
}
