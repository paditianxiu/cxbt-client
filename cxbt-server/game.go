package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
	Yaw float64 `json:"yaw"`
}

type PlayerState struct {
	UserID   uint     `json:"userId"`
	Team     string   `json:"team"`
	HP       int      `json:"hp"`
	MaxHP    int      `json:"maxHp"`
	Ammo     int      `json:"ammo"`
	IsAlive  bool     `json:"isAlive"`
	Position Position `json:"position"`
}

type GameState struct {
	RoomID    string                  `json:"roomId"`
	ScoreRed  int                     `json:"scoreRed"`
	ScoreBlue int                     `json:"scoreBlue"`
	StartTime time.Time               `json:"startTime"`
	Duration  time.Duration           `json:"duration"`
	Players   map[uint]*PlayerState `json:"players"`
	Over      bool                    `json:"over"`
}

// Global active game loops tracker (in-memory)
var activeGames = make(map[string]context.CancelFunc)

// StartGameLoop ticks 20 times per second for game state auth
func StartGameLoop(roomID string) {
	ctx, cancel := context.WithCancel(context.Background())
	activeGames[roomID] = cancel
	defer delete(activeGames, roomID)

	ticker := time.NewTicker(50 * time.Millisecond) // 20 tick/s
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			val, err := RDB.Get(Ctx, "game:"+roomID).Result()
			if err != nil { return } // Game deleted

			var state GameState
			json.Unmarshal([]byte(val), &state)

			if state.Over {
				cancel()
				return
			}

			// Check timer
			elapsed := time.Since(state.StartTime)
			remaining := state.Duration - elapsed
			if remaining <= 0 {
				state.Over = true
				EndGame(roomID, &state)
				return
			}

			// Broadcast tick state
			// In a real optimized system, we'd only broadcast delta states. 
			// For this MVP, broadcast timer and score every second (or 1 tick).
			if elapsed.Milliseconds()%1000 < 50 {
				msg := map[string]interface{}{
					"type": "tick",
					"time_left": int(remaining.Seconds()),
					"score_red": state.ScoreRed,
					"score_blue": state.ScoreBlue,
				}
				msgBytes, _ := json.Marshal(msg)
				RDB.Publish(Ctx, "room_channel:"+roomID, msgBytes)
			}
		}
	}
}

// EndGame processes results, gives EXP/Coins, and cleans up Redis
func EndGame(roomID string, state *GameState) {
	// Calculate winners
	winner := "draw"
	if state.ScoreRed > state.ScoreBlue { winner = "red" }
	if state.ScoreBlue > state.ScoreRed { winner = "blue" }

	// Give rewards via DB
	for _, p := range state.Players {
		var char SavedCharacter
		if err := DB.Where("user_id = ?", p.UserID).First(&char).Error; err == nil {
			expGain := 50
			coinGain := 100
			if winner == p.Team {
				expGain = 150
				coinGain = 300
				char.Rating += 20
			} else if winner != "draw" {
				char.Rating -= 10
			}
			char.Exp += expGain
			char.Coins += coinGain
			// Basic level up logic
			for char.Exp >= char.Level * 1000 {
				char.Exp -= char.Level * 1000
				char.Level++
			}
			DB.Save(&char)
		}
	}

	// Notify players
	msg := map[string]interface{}{
		"type": "game_over",
		"winner": winner,
		"score_red": state.ScoreRed,
		"score_blue": state.ScoreBlue,
	}
	msgBytes, _ := json.Marshal(msg)
	RDB.Publish(Ctx, "room_channel:"+roomID, msgBytes)

	// Change room state back to Waiting
	val, err := RDB.Get(Ctx, "room:"+roomID).Result()
	if err == nil {
		var room RoomConfig
		json.Unmarshal([]byte(val), &room)
		room.State = "Waiting"
		roomJSON, _ := json.Marshal(room)
		RDB.Set(Ctx, "room:"+roomID, roomJSON, 0)
	}

	RDB.Del(Ctx, "game:"+roomID)
}

// HandleHit Processes a shot from an attacker to a target
func HandleHit(roomID string, attackerID uint, targetID uint, damage int) {
	fmt.Printf("[HandleHit] room:%s attacker:%d target:%d damage:%d\n", roomID, attackerID, targetID, damage)
	val, err := RDB.Get(Ctx, "game:"+roomID).Result()
	if err != nil {
		fmt.Println("[HandleHit] game not found:", err)
		return
	}
	var state GameState
	json.Unmarshal([]byte(val), &state)

	target, exists := state.Players[targetID]
	attacker, aExists := state.Players[attackerID]
	
	fmt.Printf("[HandleHit] exists:%v aExists:%v\n", exists, aExists)
	if exists {
		fmt.Printf("[HandleHit] target isAlive:%v team:%s hp:%d\n", target.IsAlive, target.Team, target.HP)
	}
	if aExists {
		fmt.Printf("[HandleHit] attacker isAlive:%v team:%s\n", attacker.IsAlive, attacker.Team)
	}

	if !exists || !aExists || !target.IsAlive || target.Team == attacker.Team {
		fmt.Println("[HandleHit] rejected. same team or dead or missing.")
		return
	}

	target.HP -= damage
	if target.HP <= 0 {
		target.HP = 0
	}
	
	hitMsg := map[string]interface{}{
		"type": "health_update",
		"userId": targetID,
		"hp": target.HP,
	}
	hitBytes, _ := json.Marshal(hitMsg)
	RDB.Publish(Ctx, "room_channel:"+roomID, hitBytes)

	if target.HP <= 0 {
		target.IsAlive = false
		
		// Update score based on mode (assuming TDM here)
		if attacker.Team == "red" { state.ScoreRed++ } else { state.ScoreBlue++ }
		
		msg := map[string]interface{}{
			"type": "kill",
			"killer": attackerID,
			"victim": targetID,
		}
		msgBytes, _ := json.Marshal(msg)
		RDB.Publish(Ctx, "room_channel:"+roomID, msgBytes)
		
		// Setup Respawn routines
		go func(rID string, uID uint) {
			time.Sleep(5 * time.Second) // 5s respawn
			
			val2, err2 := RDB.Get(Ctx, "game:"+rID).Result()
			if err2 != nil { return }
			var st GameState
			json.Unmarshal([]byte(val2), &st)
			
			if p, ok := st.Players[uID]; ok {
				p.HP = p.MaxHP
				p.IsAlive = true
				p.Ammo = 30 // Reset ammo
				
				stJSON, _ := json.Marshal(st)
				RDB.Set(Ctx, "game:"+rID, stJSON, 0)
				
				respawnMsg := map[string]interface{}{"type": "respawn", "userId": uID}
				rBytes, _ := json.Marshal(respawnMsg)
				RDB.Publish(Ctx, "room_channel:"+rID, rBytes)
			}
		}(roomID, targetID)
	}

	stateJSON, _ := json.Marshal(state)
	RDB.Set(Ctx, "game:"+roomID, stateJSON, 0)
}
