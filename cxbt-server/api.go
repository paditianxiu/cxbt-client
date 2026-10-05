package main

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api")
	
	api.POST("/auth/register", RegisterHandler)
	api.POST("/auth/login", LoginHandler)

	protected := api.Group("/")
	protected.Use(AuthMiddleware())
	{
		// Character routes
		protected.GET("/character", getCharacterHandler)
		protected.POST("/character", saveCharacterHandler)
		
		// Room routes
		protected.GET("/rooms", getRoomsHandler)
		protected.POST("/rooms", createRoomHandler)
		protected.POST("/rooms/quickmatch", QuickMatchHandler)
		protected.POST("/rooms/:id/join", JoinRoomHandler)
		protected.POST("/rooms/:id/leave", LeaveRoomHandler)
		protected.POST("/rooms/:id/start", StartGameHandler)
		protected.POST("/rooms/:id/invite", InviteRoomHandler)

		// Social & Aux
		protected.POST("/friends", AddFriendHandler)
		protected.GET("/friends", GetFriendsHandler)
		protected.POST("/guilds", CreateGuildHandler)
		protected.GET("/mail", GetMailHandler)
		protected.POST("/mail/:id/read", ReadMailHandler)
		protected.POST("/shop/buy", BuyItemHandler)
		
		api.GET("/flush", func(c *gin.Context) {
			RDB.FlushAll(Ctx)
			c.JSON(200, gin.H{"status": "flushed"})
		})
	}
}

func getCharacterHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	
	var char SavedCharacter
	if err := DB.Where("user_id = ?", userID).First(&char).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "character not found"})
		return
	}
	
	c.JSON(http.StatusOK, char)
}

func saveCharacterHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)

	var req SavedCharacter
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	var existing SavedCharacter
	err := DB.Where("user_id = ?", userID).First(&existing).Error
	if err == nil {
		// Update existing
		existing.Name = req.Name
		existing.JobID = req.JobID
		existing.Appearance = req.Appearance
		DB.Save(&existing)
		c.JSON(http.StatusOK, existing)
	} else {
		// Create new
		req.UserID = userID
		DB.Create(&req)
		c.JSON(http.StatusOK, req)
	}
}

func getRoomsHandler(c *gin.Context) {
	// Fetch all keys matching room:*
	keys, err := RDB.Keys(Ctx, "room:*").Result()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch rooms"})
		return
	}

	var rooms []RoomConfig
	for _, key := range keys {
		val, err := RDB.Get(Ctx, key).Result()
		if err == nil {
			var room RoomConfig
			json.Unmarshal([]byte(val), &room)
			rooms = append(rooms, room)
		}
	}

	c.JSON(http.StatusOK, rooms)
}

func createRoomHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)

	var req struct {
		RoomConfig
		WeaponIds []string `json:"weaponIds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	config := req.RoomConfig
	config.ID = fmt.Sprintf("room-%d", userID)
	config.HostID = userID
	config.State = "Waiting"
	
	// Fetch username and character info
	var char SavedCharacter
	DB.Where("user_id = ?", userID).First(&char)
	username := char.Name
	if username == "" {
		username = fmt.Sprintf("Player%d", userID)
	}

	config.Players = make(map[uint]RoomPlayer)
	config.Players[userID] = RoomPlayer{
		UserID:     userID,
		Username:   username,
		Team:       "red", // Host gets red team initially
		Ready:      false,
		JobID:      char.JobID,
		Appearance: char.Appearance,
		WeaponIds:  req.WeaponIds,
	}
	
	roomJSON, _ := json.Marshal(config)
	err := RDB.Set(Ctx, "room:"+config.ID, roomJSON, 0).Err()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create room"})
		return
	}
	
	c.JSON(http.StatusOK, config)
}
