package probe

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	fibretypes "github.com/celestiaorg/celestia-app/v10/x/fibre/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

// fixedHealth answers every readiness question with st, or, blocking, not
// at all, and counts the questions.
type fixedHealth struct {
	healthpb.UnimplementedHealthServer
	st    healthpb.HealthCheckResponse_ServingStatus
	block bool
	asked atomic.Int32
}

func (h *fixedHealth) Check(ctx context.Context, req *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	h.asked.Add(1)
	if req.GetService() != "" {
		return nil, status.Error(codes.NotFound, "unknown service")
	}
	if h.block {
		<-ctx.Done()
		return nil, status.FromContextError(ctx.Err()).Err()
	}
	return &healthpb.HealthCheckResponse{Status: h.st}, nil
}

// closeWatchListener counts the connections a test server accepted and
// signals each one's close.
type closeWatchListener struct {
	net.Listener
	accepted atomic.Int32
	closed   chan struct{}
}

func (l *closeWatchListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return c, err
	}
	l.accepted.Add(1)
	return &watchedConn{Conn: c, closed: l.closed}, nil
}

type watchedConn struct {
	net.Conn
	once   sync.Once
	closed chan struct{}
}

func (c *watchedConn) Close() error {
	c.once.Do(func() { c.closed <- struct{}{} })
	return c.Conn.Close()
}

// startHealthFibre serves a Fibre endpoint with cert that answers the health
// service with h; nil serves no health service, as a server before v10.5.
func startHealthFibre(t *testing.T, cert tls.Certificate, h healthpb.HealthServer) (string, *closeWatchListener) {
	t.Helper()
	raw, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln := &closeWatchListener{Listener: raw, closed: make(chan struct{}, 8)}
	gs := grpc.NewServer(grpc.Creds(credentials.NewTLS(&tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
	})))
	fibretypes.RegisterFibreServer(gs, &fakeFibre{download: func(context.Context, *fibretypes.DownloadShardRequest) (*fibretypes.DownloadShardResponse, error) {
		return nil, errors.New("a reachability probe must not call DownloadShard")
	}})
	if h != nil {
		healthpb.RegisterHealthServer(gs, h)
	}
	go func() { _ = gs.Serve(ln) }()
	t.Cleanup(gs.Stop)
	return ln.Addr().String(), ln
}

// The readiness question rides the connection the identity was verified on,
// the connection is closed once it is answered, and whatever the answer the
// endpoint is reached.
func TestRun_ReadinessIsAskedOnTheVerifiedConnection(t *testing.T) {
	consPub, consPriv, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now()
	cert := fibreCert(t, consPriv, "test-chain", now.Add(-time.Hour), now.Add(24*time.Hour))
	for _, tc := range []struct {
		name   string
		health *fixedHealth
		want   string
	}{
		{"serving", &fixedHealth{st: healthpb.HealthCheckResponse_SERVING}, ReadinessServing},
		{"not serving", &fixedHealth{st: healthpb.HealthCheckResponse_NOT_SERVING}, ReadinessNotServing},
		{"no health service", nil, ReadinessNotReported},
		{"no answer in time", &fixedHealth{block: true}, ReadinessUnmeasured},
		{"an unknown status", &fixedHealth{st: healthpb.HealthCheckResponse_UNKNOWN}, ReadinessUnmeasured},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var h healthpb.HealthServer
			if tc.health != nil {
				h = tc.health
			}
			host, ln := startHealthFibre(t, cert, h)
			in := probeInput(host, consPub)
			in.SkipDownload, in.AskReadiness = true, true
			m := Run(context.Background(), in, nil, StepTimeouts{Health: 300 * time.Millisecond})
			if m.Outcome != OutcomeReachable || !m.TLS.OK || !m.Identity.OK {
				t.Fatalf("outcome=%s tls=%+v identity=%+v", m.Outcome, m.TLS, m.Identity)
			}
			if m.Readiness == nil || m.Readiness.Status != tc.want {
				t.Fatalf("readiness %+v, want %s", m.Readiness, tc.want)
			}
			if (tc.want == ReadinessUnmeasured) != (m.Readiness.Error != "") {
				t.Errorf("error %q on a %s answer", m.Readiness.Error, tc.want)
			}
			if tc.health != nil {
				if n := tc.health.asked.Load(); n != 1 {
					t.Errorf("asked %d times, want 1", n)
				}
			}
			if n := ln.accepted.Load(); n != 1 {
				t.Errorf("server accepted %d connections, want 1", n)
			}
			select {
			case <-ln.closed:
			case <-time.After(2 * time.Second):
				t.Error("the connection was still open after the answer")
			}
		})
	}
}

// Nothing is asked of an endpoint whose identity did not verify, nor by a
// reachability probe that does not ask.
func TestRun_ReadinessOnlyWhenAskedAndVerified(t *testing.T) {
	consPub, consPriv, _ := ed25519.GenerateKey(rand.Reader)
	otherPub, _, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now()
	cert := fibreCert(t, consPriv, "test-chain", now.Add(-time.Hour), now.Add(24*time.Hour))

	h := &fixedHealth{st: healthpb.HealthCheckResponse_SERVING}
	host, _ := startHealthFibre(t, cert, h)
	in := probeInput(host, otherPub)
	in.SkipDownload, in.AskReadiness = true, true
	if m := Run(context.Background(), in, nil, StepTimeouts{}); m.Outcome != OutcomeIdentityFail || m.Readiness != nil {
		t.Fatalf("someone else's key: outcome=%s readiness=%+v", m.Outcome, m.Readiness)
	}

	in = probeInput(host, consPub)
	in.SkipDownload = true
	if m := Run(context.Background(), in, nil, StepTimeouts{}); m.Outcome != OutcomeReachable || m.Readiness != nil {
		t.Fatalf("not asked: outcome=%s readiness=%+v", m.Outcome, m.Readiness)
	}
	if n := h.asked.Load(); n != 0 {
		t.Errorf("asked %d times, want 0", n)
	}
}
