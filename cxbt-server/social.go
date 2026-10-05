package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// --- Friends API ---
func AddFriendHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	var req struct { FriendName string `json:"friendName"` }
	c.ShouldBindJSON(&req)

	var friendChar SavedCharacter
	if err := DB.Where("name = ?", req.FriendName).First(&friendChar).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Player not found"})
		return
	}

	friendReq := Friend{
		UserID:   userID,
		FriendID: friendChar.UserID,
		Status:   "Pending",
	}
	DB.Create(&friendReq)
	c.JSON(http.StatusOK, gin.H{"status": "Request sent"})
}

func GetFriendsHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	var friends []Friend
	DB.Where("user_id = ? OR friend_id = ?", userID, userID).Find(&friends)
	c.JSON(http.StatusOK, friends)
}

// --- Guild API ---
func CreateGuildHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	var req struct { Name string `json:"name"` }
	c.ShouldBindJSON(&req)

	guild := Guild{Name: req.Name, OwnerID: userID}
	if err := DB.Create(&guild).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Guild name already taken"})
		return
	}

	member := GuildMember{GuildID: guild.ID, UserID: userID, Role: "Owner"}
	DB.Create(&member)
	
	c.JSON(http.StatusOK, guild)
}

// --- Mail API ---
func GetMailHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	var mails []Mail
	DB.Where("receiver_id = ?", userID).Find(&mails)
	c.JSON(http.StatusOK, mails)
}

func ReadMailHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	mailID := c.Param("id")

	var mail Mail
	if err := DB.Where("id = ? AND receiver_id = ?", mailID, userID).First(&mail).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Mail not found"})
		return
	}

	mail.IsRead = true
	DB.Save(&mail)
	c.JSON(http.StatusOK, mail)
}

// --- Shop & Inventory ---
func BuyItemHandler(c *gin.Context) {
	userID := c.MustGet("userId").(uint)
	var req struct {
		ItemID string `json:"itemId"`
		Price  int    `json:"price"`
	}
	c.ShouldBindJSON(&req)

	var char SavedCharacter
	DB.Where("user_id = ?", userID).First(&char)

	if char.Coins < req.Price {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not enough coins"})
		return
	}

	char.Coins -= req.Price
	DB.Save(&char)

	// Add to inventory
	var item Inventory
	if err := DB.Where("user_id = ? AND item_id = ?", userID, req.ItemID).First(&item).Error; err == nil {
		item.Count++
		DB.Save(&item)
	} else {
		DB.Create(&Inventory{UserID: userID, ItemID: req.ItemID, Count: 1})
	}

	c.JSON(http.StatusOK, gin.H{"status": "Purchased successfully", "coins": char.Coins})
}
