export { default } from "./loro_wasm.js";
import { LoroDoc, AwarenessWasm } from "./loro_wasm.js";
export * from "./loro_wasm.js";

/**
 * @deprecated Please use LoroDoc
 */
class Loro extends LoroDoc {
}
const CONTAINER_TYPES = [
    "Map",
    "Text",
    "List",
    "Tree",
    "MovableList",
    "Counter",
];
function isContainerId(s) {
    return s.startsWith("cid:");
}
/**  Whether the value is a container.
 *
 * # Example
 *
 * ```ts
 * const doc = new LoroDoc();
 * const map = doc.getMap("map");
 * const list = doc.getList("list");
 * const text = doc.getText("text");
 * isContainer(map); // true
 * isContainer(list); // true
 * isContainer(text); // true
 * isContainer(123); // false
 * isContainer("123"); // false
 * isContainer({}); // false
 * ```
 */
function isContainer(value) {
    if (typeof value !== "object" || value == null) {
        return false;
    }
    const p = Object.getPrototypeOf(value);
    if (p == null || typeof p !== "object" || typeof p["kind"] !== "function") {
        return false;
    }
    return CONTAINER_TYPES.includes(value.kind());
}
/**  Get the type of a value that may be a container.
 *
 * # Example
 *
 * ```ts
 * const doc = new LoroDoc();
 * const map = doc.getMap("map");
 * const list = doc.getList("list");
 * const text = doc.getText("text");
 * getType(map); // "Map"
 * getType(list); // "List"
 * getType(text); // "Text"
 * getType(123); // "Json"
 * getType("123"); // "Json"
 * getType({}); // "Json"
 * ```
 */
function getType(value) {
    if (isContainer(value)) {
        return value.kind();
    }
    return "Json";
}
function newContainerID(id, type) {
    return `cid:${id.counter}@${id.peer}:${type}`;
}
function newRootContainerID(name, type) {
    return `cid:root-${name}:${type}`;
}
/**
 * Awareness is a structure that allows to track the ephemeral state of the peers.
 *
 * If we don't receive a state update from a peer within the timeout, we will remove their state.
 * The timeout is in milliseconds. This can be used to handle the off-line state of a peer.
 */
class Awareness {
    constructor(peer, timeout = 30000) {
        this.listeners = new Set();
        this.inner = new AwarenessWasm(peer, timeout);
        this.peer = peer;
        this.timeout = timeout;
    }
    apply(bytes, origin = "remote") {
        const { updated, added } = this.inner.apply(bytes);
        this.listeners.forEach((listener) => {
            listener({ updated, added, removed: [] }, origin);
        });
        this.startTimerIfNotEmpty();
    }
    setLocalState(state) {
        const wasEmpty = this.inner.getState(this.peer) == null;
        this.inner.setLocalState(state);
        if (wasEmpty) {
            this.listeners.forEach((listener) => {
                listener({ updated: [], added: [this.inner.peer()], removed: [] }, "local");
            });
        }
        else {
            this.listeners.forEach((listener) => {
                listener({ updated: [this.inner.peer()], added: [], removed: [] }, "local");
            });
        }
        this.startTimerIfNotEmpty();
    }
    getLocalState() {
        return this.inner.getState(this.peer);
    }
    getAllStates() {
        return this.inner.getAllStates();
    }
    encode(peers) {
        return this.inner.encode(peers);
    }
    encodeAll() {
        return this.inner.encodeAll();
    }
    addListener(listener) {
        this.listeners.add(listener);
    }
    removeListener(listener) {
        this.listeners.delete(listener);
    }
    peers() {
        return this.inner.peers();
    }
    destroy() {
        clearInterval(this.timer);
        this.listeners.clear();
    }
    startTimerIfNotEmpty() {
        if (this.inner.isEmpty() || this.timer != null) {
            return;
        }
        this.timer = setInterval(() => {
            const removed = this.inner.removeOutdated();
            if (removed.length > 0) {
                this.listeners.forEach((listener) => {
                    listener({ updated: [], added: [], removed }, "timeout");
                });
            }
            if (this.inner.isEmpty()) {
                clearInterval(this.timer);
                this.timer = undefined;
            }
        }, this.timeout / 2);
    }
}

export { Awareness, Loro, getType, isContainer, isContainerId, newContainerID, newRootContainerID };
//# sourceMappingURL=index.js.map
