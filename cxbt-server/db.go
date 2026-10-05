package main

import (
	"context"
	"fmt"
	"log"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

var (
	DB  *gorm.DB
	RDB *redis.Client
	Ctx = context.Background()
)

func InitDB() {
	var err error
	
	// MySQL configuration from user
	user := "root"
	password := "UnKnnow@lhit.top4191792000"
	host := "39.101.142.240:3306"
	dbName := "cxbt"

	// 1. First connect without dbname to ensure the database exists
	dsnWithoutDB := fmt.Sprintf("%s:%s@tcp(%s)/?charset=utf8mb4&parseTime=True&loc=Local", user, password, host)
	tempDB, err := gorm.Open(mysql.Open(dsnWithoutDB), &gorm.Config{})
	if err != nil {
		log.Fatalf("failed to connect to mysql server: %v", err)
	}

	// Create database if not exists
	createDBCommand := fmt.Sprintf("CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;", dbName)
	if err := tempDB.Exec(createDBCommand).Error; err != nil {
		log.Fatalf("failed to create database: %v", err)
	}

	// 2. Connect to the specific database
	dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, password, host, dbName)
	DB, err = gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("failed to connect database %s: %v", dbName, err)
	}

	// Migrate the schema
	err = DB.AutoMigrate(
		&User{}, 
		&SavedCharacter{},
		&Friend{},
		&Guild{},
		&GuildMember{},
		&Mail{},
		&Inventory{},
	)
	if err != nil {
		log.Fatalf("failed to migrate database: %v", err)
	}

	log.Println("MySQL connected and migrated successfully.")

	// Initialize Redis
	RDB = redis.NewClient(&redis.Options{
		Addr:     "lhit.top:9992",
		Password: "www.lhit.top",
		DB:       10, 
	})

	_, err = RDB.Ping(Ctx).Result()
	if err != nil {
		log.Printf("WARNING: Redis connection failed: %v", err)
	} else {
		log.Println("Redis connected successfully.")
	}
}
