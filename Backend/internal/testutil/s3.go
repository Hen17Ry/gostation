//go:build integration

package testutil

import (
	"context"
	"fmt"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// DefaultS3Image : SeaweedFS en mode « mini » (maître, volume, filer et passerelle S3 dans un
// conteneur), stockage objet S3 libre et maintenu, pour tester l'implémentation S3 du stockage.
const DefaultS3Image = "chrislusf/seaweedfs:4.47"

// S3 décrit un stockage objet jetable : point d'accès (hôte:port), identifiants et bucket créé.
type S3 struct {
	Endpoint, AccessKey, SecretKey, Bucket string
}

// StartS3 démarre un SeaweedFS jetable avec un bucket et des identifiants d'accès.
func StartS3(ctx context.Context, bucket string) (S3, func(), error) {
	s := S3{AccessKey: "gostation-test", SecretKey: "gostation-test-secret", Bucket: bucket}
	ctr, err := testcontainers.Run(ctx, image("S3_TEST_IMAGE", DefaultS3Image),
		testcontainers.WithCmd("mini", "-dir=/data", "-bucket="+bucket),
		testcontainers.WithEnv(map[string]string{"AWS_ACCESS_KEY_ID": s.AccessKey, "AWS_SECRET_ACCESS_KEY": s.SecretKey}),
		testcontainers.WithExposedPorts("8333/tcp"),
		testcontainers.WithWaitStrategy(wait.ForHTTP("/").WithPort("8333/tcp").
			WithStatusCodeMatcher(func(int) bool { return true })),
	)
	stop := func() { _ = testcontainers.TerminateContainer(ctr) }
	if err != nil {
		stop()
		return S3{}, nil, fmt.Errorf("start s3 container: %w", err)
	}
	if s.Endpoint, err = ctr.PortEndpoint(ctx, "8333/tcp", ""); err != nil {
		stop()
		return S3{}, nil, fmt.Errorf("s3 endpoint: %w", err)
	}
	return s, stop, nil
}
