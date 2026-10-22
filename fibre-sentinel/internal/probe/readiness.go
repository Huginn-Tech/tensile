package probe

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// The answers a readiness question records (ReadinessResult.Status).
const (
	// ReadinessServing: the server reports every one of its own checks
	// passing (SERVING).
	ReadinessServing = "serving"
	// ReadinessNotServing: the server reports at least one of its own checks
	// failing, or that it is still starting or already stopping
	// (NOT_SERVING). Which check is in the operator's log only: the health
	// answer carries a status, never a reason.
	ReadinessNotServing = "not_serving"
	// ReadinessNotReported: the server does not answer the health service
	// (Unimplemented), as a Fibre server before celestia-app v10.5 does not.
	// Nothing is inferred from it, the server's version least of all.
	ReadinessNotReported = "not_reported"
	// ReadinessUnmeasured: any other answer, a timeout or a closed
	// connection among them. Nothing is known for this check.
	ReadinessUnmeasured = "unmeasured"
)

// ReadinessResult is an endpoint's answer to the readiness question
// (Measurement.Readiness).
type ReadinessResult struct {
	Status     string `json:"status"`
	DurationMS int64  `json:"duration_ms"`
	// Error is the answer on the wire when Status is unmeasured.
	Error string `json:"error,omitempty"`
}

// askReadiness asks the endpoint behind tc whether it is ready to take
// uploads: the standard gRPC health Check for the server as a whole (service
// ""), which celestia-app's Fibre server answers from v10.5 on. It rides the
// connection whose certificate the probe just verified, so the answer is the
// validator's own and costs its server no second connection slot, and the
// connection is closed on return: the server keeps few. Check alone is asked;
// the server does not implement Watch.
func askReadiness(ctx context.Context, vantage string, tc *tls.Conn, timeout time.Duration) *ReadinessResult {
	r := &ReadinessResult{}
	t0 := time.Now()
	// grpc closes tc once it owns it; until then, and on every early
	// return, it is this function's to close.
	defer tc.Close()

	hctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cc, err := grpc.NewClient("passthrough:///"+tc.RemoteAddr().String(),
		grpc.WithTransportCredentials(establishedCreds{tc: tc}),
		grpc.WithContextDialer(handOff(tc)),
		grpc.WithMaxHeaderListSize(maxHeaderListSize),
		grpc.WithUserAgent(userAgent),
		// as for the download (downloadAndVerify): the question goes to the
		// address L2 connected to, never through a proxy
		grpc.WithNoProxy(),
	)
	if err != nil {
		r.DurationMS = sinceMS(t0)
		r.Status, r.Error = ReadinessUnmeasured, clip(err.Error())
		return r
	}
	defer cc.Close()

	hctx = metadata.AppendToOutgoingContext(hctx, "x-fibre-observer", vantage)
	resp, err := healthpb.NewHealthClient(cc).Check(hctx, &healthpb.HealthCheckRequest{})
	r.DurationMS = sinceMS(t0)
	switch {
	case err == nil && resp.GetStatus() == healthpb.HealthCheckResponse_SERVING:
		r.Status = ReadinessServing
	case err == nil && resp.GetStatus() == healthpb.HealthCheckResponse_NOT_SERVING:
		r.Status = ReadinessNotServing
	case err == nil:
		r.Status, r.Error = ReadinessUnmeasured, "health status "+resp.GetStatus().String()
	case status.Code(err) == codes.Unimplemented:
		r.Status = ReadinessNotReported
	default:
		r.Status, r.Error = ReadinessUnmeasured, clip(wireText(err))
	}
	return r
}

// establishedCreds hands grpc-go a TLS connection whose handshake, and the
// identity check inside it, the probe already ran: the connection is the one
// handOff yields, used as it is.
type establishedCreds struct{ tc *tls.Conn }

func (c establishedCreds) ClientHandshake(_ context.Context, _ string, raw net.Conn) (net.Conn, credentials.AuthInfo, error) {
	return raw, credentials.TLSInfo{
		State:          c.tc.ConnectionState(),
		CommonAuthInfo: credentials.CommonAuthInfo{SecurityLevel: credentials.PrivacyAndIntegrity},
	}, nil
}

func (establishedCreds) ServerHandshake(net.Conn) (net.Conn, credentials.AuthInfo, error) {
	return nil, nil, errors.New("establishedCreds: client side only")
}

func (establishedCreds) Info() credentials.ProtocolInfo {
	return credentials.ProtocolInfo{SecurityProtocol: "tls", SecurityVersion: "1.3"}
}

func (c establishedCreds) Clone() credentials.TransportCredentials { return c }

func (establishedCreds) OverrideServerName(string) error { return nil }
