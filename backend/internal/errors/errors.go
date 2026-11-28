package errors

import "net/http"

type AppError struct {
	Message string
	Status  int
	Err     error
	Code    string
	Details any
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Message
}

func New(message string, status int) *AppError { return &AppError{Message: message, Status: status} }
func Wrap(err error, message string, status int) *AppError {
	return &AppError{Message: message, Status: status, Err: err}
}
func NewCoded(message string, status int, code string, details any) *AppError {
	return &AppError{Message: message, Status: status, Code: code, Details: details}
}

var ErrUnauthorized = New("Unauthorized", http.StatusUnauthorized)
var ErrBadRequest = New("Bad request", http.StatusBadRequest)
var ErrNotFound = New("Not found", http.StatusNotFound)
var ErrForbidden = New("Forbidden", http.StatusForbidden)
var ErrConflict = New("Already exists", http.StatusConflict)
