package main

import (
	"database/sql"
	"log"
	"net/url"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var DB *sql.DB

func InitDB(connStr string) error {
	// Handle bracket notation users sometimes use in connection strings:
	// e.g. postgresql://user:[pass@word]@host -> properly URL-encode the password.
	//
	// Detect: ":[" ... "]@" pattern
	if startIdx := strings.Index(connStr, ":["); startIdx != -1 {
		endIdx := strings.Index(connStr[startIdx:], "]@")
		if endIdx != -1 {
			// Extract the raw password (between :[ and ])
			rawPass := connStr[startIdx+2 : startIdx+endIdx]
			// URL-encode it so special characters (@ # etc.) don't confuse the parser
			encodedPass := url.QueryEscape(rawPass)
			// Rebuild: replace :[ rawPass ]@ with : encodedPass @
			connStr = connStr[:startIdx+1] + encodedPass + connStr[startIdx+endIdx+1:]
		}
	}

	db, err := sql.Open("pgx", connStr)
	if err != nil {
		return err
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return err
	}

	DB = db
	log.Println("Successfully connected to Supabase Postgres")
	return nil
}
