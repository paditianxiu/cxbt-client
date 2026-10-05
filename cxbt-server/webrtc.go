package main

import (
	"encoding/binary"
	"encoding/json"
	"log"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
)

var signalingUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type SignalingMessage struct {
	Type      string                    `json:"type"` 
	SDP       string                    `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit  `json:"candidate,omitempty"`
}

func ServeWebRTC(c *gin.Context) {
	conn, err := signalingUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	defer conn.Close()

	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}},
	}

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		log.Println(err)
		return
	}
	defer peerConnection.Close()

	// Handle DataChannel
	peerConnection.OnDataChannel(func(d *webrtc.DataChannel) {
		log.Printf("New DataChannel %s %d\n", d.Label(), d.ID())
		d.OnMessage(func(msg webrtc.DataChannelMessage) {
			if msg.IsString || len(msg.Data) == 0 { return }
			
			if msg.Data[0] == 1 && len(msg.Data) >= 21 {
				userID := binary.LittleEndian.Uint32(msg.Data[1:5])
				x := math.Float32frombits(binary.LittleEndian.Uint32(msg.Data[5:9]))
				z := math.Float32frombits(binary.LittleEndian.Uint32(msg.Data[9:13]))
				yaw := math.Float32frombits(binary.LittleEndian.Uint32(msg.Data[13:17]))
				
				syncMsg := map[string]interface{}{
					"type":   "sync",
					"userId": userID,
					"x":      x,
					"z":      z,
					"yaw":    yaw,
				}
				roomID := c.Query("roomId")
				
				if j, err := json.Marshal(syncMsg); err == nil {
					channel := "global_channel"
					if roomID != "" {
						channel = "room_channel:" + roomID
					}
					if RDB != nil {
						RDB.Publish(Ctx, channel, j)
					}
				}
			}
		})
	})

	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil { return }
		cJson := candidate.ToJSON()
		conn.WriteJSON(SignalingMessage{Type: "candidate", Candidate: &cJson})
	})

	for {
		var sigMsg SignalingMessage
		if err := conn.ReadJSON(&sigMsg); err != nil { break }

		if sigMsg.Type == "offer" {
			peerConnection.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sigMsg.SDP})
			answer, _ := peerConnection.CreateAnswer(nil)
			peerConnection.SetLocalDescription(answer)
			conn.WriteJSON(SignalingMessage{Type: "answer", SDP: answer.SDP})
		} else if sigMsg.Type == "candidate" && sigMsg.Candidate != nil {
			peerConnection.AddICECandidate(*sigMsg.Candidate)
		}
	}
}
