//go:build integration

package storage_test

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/testutil"
)

func TestS3Storage(t *testing.T) {
	ctx := t.Context()
	s3, stop, err := testutil.StartS3(ctx, "gostation-test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	cfg := storage.S3Config{
		Endpoint: s3.Endpoint, Region: "us-east-1", Bucket: s3.Bucket, AccessKey: s3.AccessKey, SecretKey: s3.SecretKey,
		PathStyle: true, Prefix: "staging",
	}
	// La passerelle S3 démarre juste après le port : quelques essais.
	var st *storage.S3
	for i := range 30 {
		if st, err = storage.NewS3(ctx, cfg); err == nil {
			break
		}
		if i == 29 {
			t.Fatal(err)
		}
		time.Sleep(500 * time.Millisecond)
	}

	key := "stations/0192/doc-1.bin"
	data := bytes.Repeat([]byte{0x00, 0xff, 'x'}, 4096) // binaire, plus gros qu'un tampon
	if err := st.Put(ctx, key, data); err != nil {
		t.Fatal(err)
	}
	got, err := st.Get(ctx, key)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("Get = %d bytes, %v", len(got), err)
	}
	if err := st.Put(ctx, key, []byte("v2")); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.Get(ctx, key); string(got) != "v2" {
		t.Fatalf("overwrite: got %q", got)
	}
	if err := st.Ping(ctx); err != nil {
		t.Fatal(err)
	}

	// Le préfixe isole les environnements : sans lui, l'objet n'est pas au même endroit.
	plain := cfg
	plain.Prefix = ""
	other, err := storage.NewS3(ctx, plain)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := other.Get(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("object visible without prefix: %v", err)
	}
	if got, err := other.Get(ctx, "staging/"+key); err != nil || string(got) != "v2" {
		t.Fatalf("prefixed object = %q, %v", got, err)
	}

	if err := st.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Get(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Get after delete = %v, want ErrNotFound", err)
	}
	if err := st.Delete(ctx, key); err != nil {
		t.Fatalf("Delete must be idempotent: %v", err)
	}
	for _, bad := range []string{"", "/abs", "../x", "a b"} {
		if err := st.Put(ctx, bad, []byte("x")); err == nil {
			t.Errorf("key %q accepted", bad)
		}
	}

	// Bucket absent : refus explicite au démarrage, jamais de création implicite.
	missing := cfg
	missing.Bucket = "absent"
	if _, err := storage.NewS3(ctx, missing); err == nil {
		t.Fatal("missing bucket accepted")
	}
	wrong := cfg
	wrong.SecretKey = "wrong"
	if _, err := storage.NewS3(ctx, wrong); err == nil {
		t.Fatal("wrong credentials accepted")
	}
}
