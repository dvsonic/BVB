const WebSocket = require('ws');
const http = require('http');

/**
 * 简单的WebSocket服务器用于帧同步测试
 */
class FrameSyncServer {
    constructor(port = 8080) {
        this.port = port;
        this.server = null;
        this.wss = null;
        this.rooms = new Map();
        this.clients = new Map();
        this.frameRate = 30;
        this.frameInterval = 1000 / this.frameRate;
        this.gameLoops = new Map();
        this.playerScores = new Map(); // 玩家积分数据
        this.processedScoreEvents = new Set(); // 已处理的积分事件ID（去重用）
    }

    start() {
        // 创建HTTP服务器
        this.server = http.createServer();
        
        // 创建WebSocket服务器
        this.wss = new WebSocket.Server({ server: this.server });
        
        // 处理WebSocket连接
        this.wss.on('connection', (ws) => {
            // 为每个客户端生成唯一ID
            const clientId = this.generateClientId();
            this.clients.set(clientId, {
                ws: ws,
                playerId: null,
                roomId: null
            });
            
            // 处理消息
            ws.on('message', (data) => {
                this.handleMessage(clientId, data);
            });
            
            // 处理断开连接
            ws.on('close', () => {
                this.handleDisconnect(clientId);
            });
            
            // 处理错误
            ws.on('error', (error) => {
                console.error('WebSocket错误:', error);
            });
        });
        
        // 启动服务器
        this.server.listen(this.port, () => {
            console.log(`帧同步服务器运行在端口 ${this.port}`);
        });
    }

    generateClientId() {
        return 'client_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * 生成确定性随机种子
     */
    generateRandomSeed(roomId) {
        // 使用房间ID和时间戳生成确定性种子
        let hash = 0;
        const str = roomId + Date.now().toString();
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash);
    }

    handleMessage(clientId, data) {
        try {
            const message = JSON.parse(data);
            const client = this.clients.get(clientId);
            
            if (!client) {
                return;
            }
            
            switch (message.type) {
                case 'joinRoom':
                    this.handleJoinRoom(clientId, message.data);
                    break;
                case 'leaveRoom':
                    this.handleLeaveRoom(clientId, message.data);
                    break;
                case 'playerInput':
                    this.handlePlayerInput(clientId, message.data);
                    break;
                case 'findOrCreateRoom':
                    this.handleFindOrCreateRoom(clientId, message.data);
                    break;
                case 'gameStart':
                    this.handleGameStart(clientId, message.data);
                    break;
                case 'playerScore':
                    this.handlePlayerScore(clientId, message.data);
                    break;
            }
        } catch (error) {
            console.error('处理消息错误:', error);
        }
    }

    handleFindOrCreateRoom(clientId, data) {
        let joined = false;
        // 查找一个正在等待且未满的房间 (假设最大玩家数为2)
        for (const [roomId, room] of this.rooms) {
            if (room.gameState === 'waiting' && room.players.size < 2) {
                this.handleJoinRoom(clientId, { roomId, playerId: data.playerId });
                joined = true;
                break;
            }
        }

        // 如果没有找到合适的房间，则创建一个新房间
        if (!joined) {
            const newRoomId = 'room_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            this.handleJoinRoom(clientId, { roomId: newRoomId, playerId: data.playerId });
        }
    }

    handleJoinRoom(clientId, data) {
        const { roomId, playerId } = data;
        const client = this.clients.get(clientId);
        
        if (!client) {
            return;
        }
        
        // 创建房间（如果不存在）
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                id: roomId,
                players: new Map(),
                gameState: 'waiting',
                currentFrame: 0,
                inputBuffer: new Map(),
                ownerId: null // 新增房主ID
            });
        }
        
        const room = this.rooms.get(roomId);

        // 如果是第一个加入的玩家，则设为房主
        if (room.players.size === 0) {
            room.ownerId = playerId;
        }
        
        // 添加玩家到房间
        room.players.set(playerId, {
            playerId: playerId,
            clientId: clientId,
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 }
        });
        
        // 更新客户端信息
        client.playerId = playerId;
        client.roomId = roomId;
        
        // 发送房间信息
        this.sendToClient(clientId, {
            type: 'roomInfo',
            data: {
                roomId: roomId,
                ownerId: room.ownerId, // 在房间信息中包含房主ID
                players: Array.from(room.players.values()).map(p => ({
                    playerId: p.playerId
                }))
            }
        });
        
        // 通知房间内其他玩家
        this.broadcastToRoom(roomId, {
            type: 'playerJoined',
            data: { 
                playerId: playerId,
                ownerId: room.ownerId // 新玩家加入时，也广播最新的房主信息
            }
        }, clientId);
        
        console.log(`玩家 ${playerId} 加入房间 ${roomId}, 房主是 ${room.ownerId}`);
        this.broadcastRoomState(roomId);
    }

    handleLeaveRoom(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }
        
        const roomId = client.roomId;
        const room = this.rooms.get(roomId);
        if (room) {
            const leavingPlayerId = client.playerId;
            room.players.delete(leavingPlayerId);
            
            // 如果房间为空，删除房间
            if (room.players.size === 0) {
                this.rooms.delete(client.roomId);
                this.stopGameLoop(client.roomId);
            } else {
                // 如果离开的是房主，则重新选举一个
                if (room.ownerId === leavingPlayerId) {
                    room.ownerId = room.players.keys().next().value;
                }
                // 向所有剩余玩家广播最新的房间状态
                this.broadcastRoomState(roomId);
            }
        }
        
        client.playerId = null;
        client.roomId = null;
    }

    handlePlayerInput(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }
        
        const room = this.rooms.get(client.roomId);
        if (!room || room.gameState !== 'playing') {
            return;
        }
        
        // 服务器决定输入的生效帧
        // 接收到的输入，将在服务器当前帧的基础上，加上缓冲帧数后生效
        const bufferFrames = 1; // 改为0以实现本地最低延迟 (原为3或1)
        const targetFrame = room.currentFrame + bufferFrames;
        const { input } = data;
        
        // 确保该帧的输入数组存在
        if (!room.inputBuffer.has(targetFrame)) {
            room.inputBuffer.set(targetFrame, []);
        }
        
        const frameInputs = room.inputBuffer.get(targetFrame);
        
        // 查找该玩家在这一帧是否已经有输入
        const playerInputIndex = frameInputs.findIndex(
            (existingInput) => existingInput.playerId === input.playerId
        );
        
        if (playerInputIndex > -1) {
            // 如果有，用新的输入覆盖旧的输入
            frameInputs[playerInputIndex] = input;
        } else {
            // 如果没有，直接添加新输入
            frameInputs.push(input);
        }
    }

    handleGameStart(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }

        const room = this.rooms.get(client.roomId);
        if (!room) {
            return;
        }

        // 验证发起者是否为房主
        if (client.playerId !== room.ownerId) {
            console.log(`玩家 ${client.playerId} 尝试开始游戏但不是房主。`);
            return;
        }
        
        this.startGame(client.roomId);
    }

    startGame(roomId) {
        const room = this.rooms.get(roomId);
        
        if (!room) {
            return;
        }
        
        room.gameState = 'playing';
        room.currentFrame = 0;
        
        // 生成确定性随机种子（基于房间ID和时间戳）
        const randomSeed = this.generateRandomSeed(roomId);
        
        // 清理积分事件历史
        this.clearScoreEventsForRoom(roomId);
        
        // 通知所有玩家游戏开始，包含当前帧信息和随机种子
        this.broadcastToRoom(roomId, {
            type: 'gameStart',
            data: {
                timestamp: Date.now(),
                currentFrame: room.currentFrame,
                randomSeed: randomSeed
            }
        });
        
        // 延迟启动游戏循环，给客户端时间同步
        setTimeout(() => {
            this.startGameLoop(roomId);
        }, 100); // 延迟100毫秒 (原为1000)
        
        console.log(`房间 ${roomId} 游戏开始, 随机种子: ${randomSeed}`);
    }

    clearScoreEventsForRoom(roomId) {
        // 清理与该房间相关的积分事件
        // 这里简化处理，直接清理所有积分事件
        // 在实际应用中可以根据roomId进行更精确的清理
        this.processedScoreEvents.clear();
        
        // 重置房间内所有玩家的积分
        const room = this.rooms.get(roomId);
        if (room) {
            room.players.forEach(player => {
                this.playerScores.set(player.playerId, 0);
            });
        }
        
        console.log(`房间 ${roomId} 的积分事件历史已清理`);
    }

    startGameLoop(roomId) {
        const room = this.rooms.get(roomId);
        
        if (!room) {
            return;
        }
        
        const gameLoop = setInterval(() => {
            this.processFrame(roomId);
        }, this.frameInterval);
        
        this.gameLoops.set(roomId, gameLoop);
    }

    stopGameLoop(roomId) {
        const gameLoop = this.gameLoops.get(roomId);
        if (gameLoop) {
            clearInterval(gameLoop);
            this.gameLoops.delete(roomId);
        }
    }

    processFrame(roomId) {
        const room = this.rooms.get(roomId);
        
        if (!room || room.gameState !== 'playing') {
            return;
        }
        
        const currentInputs = room.inputBuffer.get(room.currentFrame) || [];
        
        const frameData = {
            frameId: room.currentFrame,
            inputs: currentInputs,
            timestamp: Date.now()
        };
        
        // 发送帧数据给所有玩家
        this.broadcastToRoom(roomId, {
            type: 'frameData',
            data: frameData
        });
        
        // 清理旧的输入缓冲
        room.inputBuffer.delete(room.currentFrame - 10);
        
        room.currentFrame++;
    }

    broadcastRoomState(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        const roomState = {
            roomId: room.id,
            ownerId: room.ownerId,
            players: Array.from(room.players.values()).map(p => ({
                playerId: p.playerId
            }))
        };

        this.broadcastToRoom(roomId, {
            type: 'roomInfo',
            data: roomState
        });
    }

    handleDisconnect(clientId) {
        const client = this.clients.get(clientId);
        
        if (client && client.roomId) {
            this.handleLeaveRoom(clientId, {});
        }
        
        this.clients.delete(clientId);
    }

    sendToClient(clientId, message) {
        const client = this.clients.get(clientId);
        
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    }

    broadcastToRoom(roomId, message, excludeClientId = null) {
        const room = this.rooms.get(roomId);
        
        if (!room) {
            return;
        }
        
        room.players.forEach(player => {
            if (player.clientId !== excludeClientId) {
                this.sendToClient(player.clientId, message);
            }
        });
    }

    handlePlayerScore(clientId, data) {
        const client = this.clients.get(clientId);
        
        if (!client || !client.roomId) {
            return;
        }

        const { eventId, frameId, killerPlayerId, victimPlayerId, score } = data;
        
        // 检查是否已经处理过这个事件
        if (this.processedScoreEvents.has(eventId)) {
            console.log(`重复的积分事件被忽略: ${eventId}`);
            return;
        }
        
        // 记录已处理的事件ID
        this.processedScoreEvents.add(eventId);
        
        // 定期清理旧的事件ID（保留最近1000个）
        if (this.processedScoreEvents.size > 1000) {
            const eventsArray = Array.from(this.processedScoreEvents);
            const toKeep = eventsArray.slice(-500); // 保留最新的500个
            this.processedScoreEvents = new Set(toKeep);
        }
        
        // 更新积分
        const currentScore = this.playerScores.get(killerPlayerId) || 0;
        this.playerScores.set(killerPlayerId, currentScore + score);
        
        // 广播积分更新给房间内所有玩家
        this.broadcastToRoom(client.roomId, {
            type: 'scoreUpdate',
            data: {
                eventId,
                frameId,
                killerPlayerId,
                victimPlayerId,
                score,
                totalScore: currentScore + score,
                timestamp: Date.now()
            }
        });
        
        console.log(`玩家 ${killerPlayerId} 获得积分 ${score}，总积分: ${currentScore + score} (事件ID: ${eventId})`);
    }

    getPlayerScore(playerId) {
        return this.playerScores.get(playerId) || 0;
    }

    getRoomScores(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return {};
        }
        
        const scores = {};
        room.players.forEach(player => {
            scores[player.playerId] = this.getPlayerScore(player.playerId);
        });
        
        return scores;
    }

    resetPlayerScore(playerId) {
        this.playerScores.delete(playerId);
    }

    stop() {
        // 停止所有游戏循环
        this.gameLoops.forEach(gameLoop => {
            clearInterval(gameLoop);
        });
        
        // 关闭所有连接
        this.clients.forEach(client => {
            client.ws.close();
        });
        
        // 关闭服务器
        if (this.server) {
            this.server.close();
        }
        
        console.log('服务器已关闭');
    }
}

// 创建并启动服务器
const server = new FrameSyncServer(8080);
server.start();

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，正在关闭服务器...');
    server.stop();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('收到SIGINT信号，正在关闭服务器...');
    server.stop();
    process.exit(0);
});