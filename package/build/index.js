"use strict";
/**
 * Railway MCP Travel Planner Server
 * ----------------------------------
 * This MCP handles travel-related queries (IRCTC train info, route planner, etc.)
 * and communicates via STDIO with your LLM orchestrator.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const axios_1 = __importDefault(require("axios"));
const readline = __importStar(require("readline"));
// Initialize input/output streams (for MCP-style communication)
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
});
console.log("🚆 Railway MCP Travel Planner is now active.");
console.log("Awaiting requests from LLM orchestrator...");
// Handle incoming messages from LLM orchestrator
rl.on("line", async (input) => {
    try {
        const message = JSON.parse(input);
        // 🔍 Log what LLM sends
        console.log("📩 Received raw message from LLM:", message);
        if (message.type === "ping") {
            console.log("⚡ LLM invoked: ping");
            sendResponse({ type: "pong", message: "Railway MCP is alive!" });
        }
        else if (message.type === "train_search") {
            console.log("🚆 LLM invoked: train_search");
            const { source, destination, date } = message.data;
            const result = await handleTrainSearch(source, destination, date);
            sendResponse({ type: "train_result", data: result });
        }
        else {
            console.log("❓ Unknown request type from LLM:", message.type);
            sendResponse({ type: "error", message: "Unknown request type" });
        }
    }
    catch (err) {
        console.error("❌ Error parsing LLM message:", err.message);
        sendResponse({ type: "error", message: err.message });
    }
});
// --- Helper Functions ---
function sendResponse(response) {
    process.stdout.write(JSON.stringify(response) + "\n");
}
// 🔧 Live IRCTC Integration (using RapidAPI)
async function handleTrainSearch(source, destination, date) {
    try {
        const options = {
            method: "GET",
            url: "https://irctc1.p.rapidapi.com/api/v3/trainBetweenStations",
            params: {
                fromStationCode: source,
                toStationCode: destination,
                dateOfJourney: date,
            },
            headers: {
                "X-RapidAPI-Key": process.env.IRCTC_API_KEY,
                "X-RapidAPI-Host": "irctc1.p.rapidapi.com",
            },
        };
        const response = await axios_1.default.request(options);
        const trains = response.data?.data || [];
        if (!trains.length)
            throw new Error("No trains found");
        return trains.map((t) => ({
            train_name: t.train_name,
            train_number: t.train_number,
            departure: t.from_std,
            arrival: t.to_std,
            duration: t.duration,
            source,
            destination,
            date,
        }));
    }
    catch (error) {
        console.error("❌ Error fetching live train data:", error.message);
        return [
            {
                train_name: "Mock Express (API Error Fallback)",
                train_number: "00000",
                departure: "00:00",
                arrival: "00:00",
                duration: "N/A",
                source,
                destination,
                date,
            },
        ];
    }
}
// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\nShutting down Railway MCP server...");
    rl.close();
    process.exit(0);
});
