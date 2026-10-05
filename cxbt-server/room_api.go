package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
	"github.com/gin-gonic/gin"
)

// In real-world, we'd use Redis locks for concurrency. We omit locks for brevity in this MVP.

func QuickMatchHandler(c *gin.Context) {
	// 1. Look for waiting rooms in Redis
	keys, _ := RDB.Keys(Ctx, "room:*").Result()
	for _, key := range keys {
		val, _ := RDB.Get(Ctx, key).Result()
		var room RoomConfig
		json.Unmarshal([]byte(val), &room)

		if room.State == "Waiting" && len(room.Players) < room.MaxPlayers && room.Password == "" {
			c.JSON(http.StatusOK, gin.H{"roomId": room.ID, "message": "Match found"})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "No available rooms found, try creating one"})
}

func JoinRoomHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	roomID := c.Param("id")

	var req struct {
		Password  string   `json:"password"`
		WeaponIds []string `json:"weaponIds"`
	}
	c.ShouldBindJSON(&req)

	val, err := RDB.Get(Ctx, "room:"+roomID).Result()
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
		return
	}

	var room RoomConfig
	json.Unmarshal([]byte(val), &room)

	if room.State != "Waiting" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Game already started"})
		return
	}
	if room.Password != "" && room.Password != req.Password {
		c.JSON(http.StatusForbidden, gin.H{"error": "Invalid password"})
		return
	}
	if len(room.Players) >= room.MaxPlayers {
		c.JSON(http.StatusForbidden, gin.H{"error": "Room is full"})
		return
	}

	// Fetch username
	var char SavedCharacter
	DB.Where("user_id = ?", userID).First(&char)
	username := char.Name
	if username == "" {
		username = fmt.Sprintf("Player%d", userID)
	}

	// Auto balance team
	reds, blues := 0, 0
	for _, p := range room.Players {
		if p.Team == "red" { reds++ } else { blues++ }
	}
	assignedTeam := "red"
	if blues < reds && room.BalanceTeams { assignedTeam = "blue" }

	if room.Players == nil {
		room.Players = make(map[uint]RoomPlayer)
	}
	room.Players[userID] = RoomPlayer{
		UserID:     userID,
		Username:   username,
		Team:       assignedTeam,
		Ready:      false,
		JobID:      char.JobID,
		Appearance: char.Appearance,
		WeaponIds:  req.WeaponIds,
	}

	roomJSON, _ := json.Marshal(room)
	RDB.Set(Ctx, "room:"+roomID, roomJSON, 0)
	
	// Notify via WS
	RDB.Publish(Ctx, "room_channel:"+roomID, `{"type":"join","userId":`+fmt.Sprint(userID)+`}`)

	c.JSON(http.StatusOK, room)
}

func LeaveRoomHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	roomID := c.Param("id")

	val, err := RDB.Get(Ctx, "room:"+roomID).Result()
	if err == nil {
		var room RoomConfig
		json.Unmarshal([]byte(val), &room)
		delete(room.Players, userID)

		if len(room.Players) == 0 {
			RDB.Del(Ctx, "room:"+roomID)
		} else {
			if room.HostID == userID {
				// Assign new host
				for id := range room.Players {
					room.HostID = id
					break
				}
			}
			roomJSON, _ := json.Marshal(room)
			RDB.Set(Ctx, "room:"+roomID, roomJSON, 0)
			RDB.Publish(Ctx, "room_channel:"+roomID, `{"type":"leave","userId":`+fmt.Sprint(userID)+`}`)
		}
	}
	c.JSON(http.StatusOK, gin.H{"status": "left"})
}

func StartGameHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	roomID := c.Param("id")

	val, err := RDB.Get(Ctx, "room:"+roomID).Result()
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Room not found"})
		return
	}

	var room RoomConfig
	json.Unmarshal([]byte(val), &room)

	if room.HostID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only host can start"})
		return
	}

	room.State = "Playing"
	
	// Initialize Game State
	state := GameState{
		RoomID:    roomID,
		ScoreRed:  0,
		ScoreBlue: 0,
		StartTime: time.Now(),
		Duration:  3 * time.Minute,
		Players:   make(map[uint]*PlayerState),
	}
	for id, p := range room.Players {
		state.Players[id] = &PlayerState{
			UserID:   id,
			Team:     p.Team,
			HP:       100, // Would pull from Character stats usually
			MaxHP:    100,
			Ammo:     30,
			IsAlive:  true,
		}
	}
	
	roomJSON, _ := json.Marshal(room)
	RDB.Set(Ctx, "room:"+roomID, roomJSON, 0)
	
	stateJSON, _ := json.Marshal(state)
	RDB.Set(Ctx, "game:"+roomID, stateJSON, 0)
	
	// Start Tick Server for this room (Goroutine)
	go StartGameLoop(roomID)

	RDB.Publish(Ctx, "room_channel:"+roomID, `{"type":"start_game"}`)
	c.JSON(http.StatusOK, gin.H{"status": "started"})
}

func InviteRoomHandler(c *gin.Context) {
	roomID := c.Param("id")
	userID := "Unknown"
	if val, exists := c.Get("userId"); exists {
		userID = fmt.Sprintf("%v", val)
	}
	
	msg := map[string]interface{}{
		"type": "invite",
		"userId": "系统",
		"message": "玩家 " + userID + " 邀请大家加入房间 [ID: " + roomID + "]！赶快去加入吧！",
	}
	
	if RDB != nil {
		msgBytes, _ := json.Marshal(msg)
		RDB.Publish(Ctx, "global_channel", string(msgBytes))
	}
	
	c.JSON(http.StatusOK, gin.H{"success": true})
}
