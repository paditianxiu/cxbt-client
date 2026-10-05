package main

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// --- User & Character ---
type User struct {
	gorm.Model
	Username string `gorm:"type:varchar(255);uniqueIndex;not null" json:"username"`
	Password string `gorm:"not null" json:"-"`
}

type Appearance struct {
	Gender    int `json:"gender"`
	Hair      int `json:"hair"`
	Eyes      int `json:"eyes"`
	Mouth     int `json:"mouth"`
	Accessory int `json:"accessory"`
}

func (a *Appearance) Scan(value interface{}) error {
	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, a)
	case string:
		return json.Unmarshal([]byte(v), a)
	default:
		return errors.New(fmt.Sprintf("type assertion failed: %T", value))
	}
}

func (a Appearance) Value() (driver.Value, error) {
	return json.Marshal(a)
}

type SavedCharacter struct {
	gorm.Model
	UserID     uint       `gorm:"uniqueIndex" json:"userId"`
	Version    int        `json:"version"`
	Name       string     `gorm:"type:varchar(255);uniqueIndex;not null" json:"name"`
	JobID      string     `json:"jobId"`
	Appearance Appearance `gorm:"type:json" json:"appearance"`
	Level      int        `gorm:"default:1" json:"level"`
	Exp        int        `gorm:"default:0" json:"exp"`
	Coins      int        `gorm:"default:1000" json:"coins"`
	Rating     int        `gorm:"default:1200" json:"rating"` // Matchmaking ELO
}

// --- Social & Auxiliary ---
type Friend struct {
	gorm.Model
	UserID   uint   `json:"userId"`
	FriendID uint   `json:"friendId"`
	Status   string `json:"status"` // "Pending", "Accepted"
}

type Guild struct {
	gorm.Model
	Name    string `gorm:"type:varchar(255);uniqueIndex" json:"name"`
	OwnerID uint   `json:"ownerId"`
}

type GuildMember struct {
	gorm.Model
	GuildID uint   `json:"guildId"`
	UserID  uint   `json:"userId"`
	Role    string `json:"role"` // "Member", "Admin", "Owner"
}

type Mail struct {
	gorm.Model
	ReceiverID uint   `json:"receiverId"`
	SenderID   uint   `json:"senderId"` // 0 if system mail
	Title      string `json:"title"`
	Content    string `json:"content"`
	IsRead     bool   `json:"isRead"`
	Attachment string `json:"attachment"` // JSON formatted items
}

type Inventory struct {
	gorm.Model
	UserID uint   `json:"userId"`
	ItemID string `json:"itemId"`
	Count  int    `json:"count"`
}

// --- Room & Game (Stored in Redis) ---
type RoomPlayer struct {
	UserID     uint       `json:"userId"`
	Username   string     `json:"username"`
	Team       string     `json:"team"` // "red" or "blue"
	Ready      bool       `json:"ready"`
	JobID      string     `json:"jobId"`
	Appearance Appearance `json:"appearance"`
	WeaponIds  []string   `json:"weaponIds"`
}

type RoomConfig struct {
	ID           string                `json:"id"`
	Name         string                `json:"name"`
	Password     string                `json:"password"`
	MaxPlayers   int                   `json:"maxPlayers"`
	BalanceTeams bool                  `json:"balanceTeams"`
	ModeID       string                `json:"modeId"`
	ModeName     string                `json:"modeName"`
	MapID        string                `json:"mapId"`
	MapName      string                `json:"mapName"`
	HostID       uint                  `json:"hostId"`
	Players      map[uint]RoomPlayer   `json:"players"` // mapping UserID -> Player
	State        string                `json:"state"`   // "Waiting", "Playing"
}
