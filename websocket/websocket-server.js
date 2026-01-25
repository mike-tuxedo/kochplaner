/**
 * WebSocket Sync Server for Loro CRDT
 *
 * Simple "dumb" server that:
 * - Stores binary snapshots in SQLite
 * - Relays updates to connected clients
 * - No knowledge of data content (can be encrypted)
 */

const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const DB_FILE = './sync-data.db';

// Initialize database
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('[DB] Connection error:', err.message);
        process.exit(1);
    }
    console.log('[DB] Connected to SQLite database');
});

// Create table if not exists
db.run(`
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        binary BLOB,
        updated_at INTEGER
    )
`, (err) => {
    if (err) console.error('[DB] Table creation error:', err.message);
    else console.log('[DB] Documents table ready');
});

// Track connected clients
const clients = new Map();

// Start WebSocket server
const wss = new WebSocket.Server({ port: PORT });
console.log(`[Server] WebSocket server running on port ${PORT}`);

wss.on('connection', (ws) => {
    const clientId = uuidv4();
    clients.set(clientId, ws);
    console.log(`[Server] Client connected: ${clientId} (${clients.size} total)`);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(clientId, ws, message);
        } catch (err) {
            console.error('[Server] Invalid message:', err.message);
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`[Server] Client disconnected: ${clientId} (${clients.size} remaining)`);
    });

    ws.on('error', (err) => {
        console.error(`[Server] Client error ${clientId}:`, err.message);
    });
});

/**
 * Handle incoming messages
 */
function handleMessage(clientId, ws, message) {
    const { type, payload } = message;

    switch (type) {
        case 'get':
            handleGet(ws, payload);
            break;

        case 'update':
            handleUpdate(clientId, payload);
            break;

        case 'getState':
            ws.send(JSON.stringify({
                type: 'getState',
                clients: clients.size
            }));
            break;

        default:
            console.log(`[Server] Unknown message type: ${type}`);
    }
}

/**
 * Get document from database
 */
function handleGet(ws, payload) {
    const { id } = payload;
    if (!id) return;

    db.get('SELECT binary FROM documents WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('[DB] Get error:', err.message);
            return;
        }

        if (row && row.binary) {
            // Convert Buffer to base64 for efficient JSON transport
            const base64 = row.binary.toString('base64');

            ws.send(JSON.stringify({
                type: 'get',
                payload: {
                    id,
                    binary: base64,
                    encoding: 'base64'
                }
            }));
            console.log(`[Server] Sent document: ${id} (${row.binary.length} bytes)`);
        } else {
            // Send empty response so client knows it can send its state
            ws.send(JSON.stringify({
                type: 'get',
                payload: { id, binary: null }
            }));
            console.log(`[Server] Document not found: ${id} (sent empty response)`);
        }
    });
}

/**
 * Update document and broadcast to other clients
 */
function handleUpdate(clientId, payload) {
    const { id, binary, encoding } = payload;
    if (!id || !binary) return;

    // Convert base64 string or legacy object to Buffer
    let binaryBuffer;
    if (encoding === 'base64' || typeof binary === 'string') {
        binaryBuffer = Buffer.from(binary, 'base64');
    } else {
        // Legacy: object format
        const length = Object.keys(binary).length;
        binaryBuffer = Buffer.alloc(length);
        for (let i = 0; i < length; i++) {
            binaryBuffer[i] = binary[i];
        }
    }

    const now = Date.now();

    // Upsert document
    db.run(`
        INSERT INTO documents (id, binary, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            binary = excluded.binary,
            updated_at = excluded.updated_at
    `, [id, binaryBuffer, now], function(err) {
        if (err) {
            console.error('[DB] Update error:', err.message);
            return;
        }
        console.log(`[Server] Document updated: ${id} (${binaryBuffer.length} bytes)`);
    });

    // Broadcast base64 to other clients
    const base64 = binaryBuffer.toString('base64');
    const broadcastMessage = JSON.stringify({
        type: 'update',
        payload: { id, binary: base64, encoding: 'base64' }
    });

    let broadcastCount = 0;
    clients.forEach((clientWs, cid) => {
        if (cid !== clientId && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(broadcastMessage);
            broadcastCount++;
        }
    });

    if (broadcastCount > 0) {
        console.log(`[Server] Broadcasted update to ${broadcastCount} clients`);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');

    wss.clients.forEach((ws) => ws.close());

    db.close((err) => {
        if (err) console.error('[DB] Close error:', err.message);
        else console.log('[DB] Connection closed');
        process.exit(0);
    });
});

console.log('[Server] Ready to accept connections');
