package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins
	},
}

type Client struct {
	ID       string
	RoomID   string
	Conn     *websocket.Conn
	Send     chan []byte
	Done     chan struct{}
}

func ServeWs(c *gin.Context) {
	// Ideally you would validate JWT here too
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	
	roomID := c.Query("roomId")
	playerID := c.Query("playerId")

	client := &Client{
		ID:     playerID,
		RoomID: roomID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Done:   make(chan struct{}),
	}
	
	go client.readPump()
	go client.writePump()
	
	// Subscribe to Redis PubSub for this room
	go client.subscribeRedis()
}

func (c *Client) readPump() {
	defer func() {
		close(c.Done)
		c.Conn.Close()
	}()
	
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}
		
		// Parse specific game messages (e.g. hit detection)
		var gameMsg map[string]interface{}
		if err := json.Unmarshal(message, &gameMsg); err == nil {
			if gameMsg["type"] == "hit" && c.RoomID != "" {
				attackerID := c.ID // Should parse to uint
				var targetID uint
				if t, ok := gameMsg["targetId"].(float64); ok {
					targetID = uint(t)
				} else if tStr, ok := gameMsg["targetId"].(string); ok {
					fmt.Sscanf(tStr, "%d", &targetID)
				}
				damage := int(gameMsg["damage"].(float64))
				
				// Very basic string to uint hack for the sake of the MVP
				var attID uint
				fmt.Sscanf(attackerID, "%d", &attID)
				
				HandleHit(c.RoomID, attID, targetID, damage)
				continue // handled by server authoritative logic
			}
		}

		// Broadcast everything else (positions, etc) to Redis channel
		if RDB != nil {
			channel := "global_channel"
			if c.RoomID != "" {
				channel = "room_channel:" + c.RoomID
			}
			RDB.Publish(Ctx, channel, message)
		}
	}
}

func (c *Client) writePump() {
	defer func() {
		c.Conn.Close()
	}()
	
	for {
		select {
		case message, ok := <-c.Send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			
			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			
			if err := w.Close(); err != nil {
				return
			}
		}
	}
}

// subscribeRedis listens to Redis messages for the room and writes to WebSocket
func (c *Client) subscribeRedis() {
	if RDB == nil {
		return
	}
	channel := "global_channel"
	if c.RoomID != "" {
		channel = "room_channel:" + c.RoomID
	}

	pubsub := RDB.Subscribe(Ctx, channel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	
	go func() {
		<-c.Done
		pubsub.Close()
	}()

	for msg := range ch {
		var dat map[string]interface{}
		if err := json.Unmarshal([]byte(msg.Payload), &dat); err == nil {
			select {
			case c.Send <- []byte(msg.Payload):
			default:
				// If Send channel is full, drop the message and continue
			}
		}
	}
}
