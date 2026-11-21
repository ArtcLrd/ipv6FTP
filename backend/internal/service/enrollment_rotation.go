package service

import (
	"bytes"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"net/url"
)

// EnrollmentRotation configures the signing pin and optional previous responder.
type EnrollmentRotation struct {
	Origin        string
	Epoch         uint32
	Signer        *ecdsa.PrivateKey
	PreviousKey   *ecdh.PrivateKey
	PreviousKeyID string
}

func (r *EnrollmentRotation) statement(keyID string, key []byte) []byte {
	var statement bytes.Buffer
	for _, part := range [][]byte{[]byte("ipv6ftp/enrollment-key/v1"), []byte(r.Origin), []byte(keyID), key} {
		binary.Write(&statement, binary.BigEndian, uint16(len(part)))
		statement.Write(part)
	}
	binary.Write(&statement, binary.BigEndian, r.Epoch)
	return statement.Bytes()
}

func (r *EnrollmentRotation) metadata(id string, key []byte) (string, string, error) {
	origin, err := url.Parse(r.Origin)
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil ||
		r.Origin != "https://"+origin.Host || len(r.Origin) > 255 || r.Epoch == 0 ||
		r.Signer == nil || r.Signer.Curve.Params().Name != "P-256" {
		return "", "", errors.New("invalid enrollment rotation configuration")
	}
	public, err := x509.MarshalPKIXPublicKey(&r.Signer.PublicKey)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(r.statement(id, key))
	signature, err := ecdsa.SignASN1(rand.Reader, r.Signer, digest[:])
	return base64.RawURLEncoding.EncodeToString(public), base64.RawURLEncoding.EncodeToString(signature), err
}
