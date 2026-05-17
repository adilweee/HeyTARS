const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5600);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";
const OLLAMA_URL = "http://localhost:11434/api/generate";
const MEMORY_PATH = path.join(__dirname, "memory.json");

function sendJson(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

function readMemory() {
    if (!fs.existsSync(MEMORY_PATH)) return [];

    try {
        const data = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8"));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeMemory(memory) {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), "utf8");
}

function cleanText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[.,!?']/g, "")
        .replace(/’/g, "")
        .trim();
}

function extractMemoryText(message) {
    const raw = String(message || "").trim();
    const clean = cleanText(raw);

    const triggers = [
        "şunu hatırla",
        "sunu hatirla",
        "bunu hatırla",
        "bunu hatirla",
        "hatırla",
        "hatirla",
        "hafızana kaydet",
        "hafizana kaydet",
        "aklında tut",
        "aklinda tut"
    ];

    for (const trigger of triggers) {
        const index = clean.indexOf(trigger);

        if (index >= 0) {
            return raw
                .slice(index + trigger.length)
                .replace(/^[:\s-]+/, "")
                .trim();
        }
    }

    return "";
}

function handleMemoryCommand(message) {
    const clean = cleanText(message);

    if (
        clean.includes("hafızanı temizle") ||
        clean.includes("hafizani temizle") ||
        clean.includes("hafızayı temizle") ||
        clean.includes("hafizayi temizle")
    ) {
        writeMemory([]);
        return {
            handled: true,
            answer: "Hafızam temizlendi. Dijital unutkanlık modu tamamlandı.",
            memory: []
        };
    }

    if (
        clean.includes("hafızanı göster") ||
        clean.includes("hafizani goster") ||
        clean.includes("neleri hatırlıyorsun") ||
        clean.includes("neleri hatirliyorsun")
    ) {
        const memory = readMemory();

        if (!memory.length) {
            return {
                handled: true,
                answer: "Şu an kayıtlı hafızam yok.",
                memory
            };
        }

        const summary = memory
            .slice(-10)
            .map((item, index) => `${index + 1}. ${item.text}`)
            .join("\n");

        return {
            handled: true,
            answer: "Hatırladıklarım:\n" + summary,
            memory
        };
    }

    const memoryText = extractMemoryText(message);

    if (memoryText) {
        const memory = readMemory();
        const normalized = cleanText(memoryText);
        const exists = memory.some(item => cleanText(item.text) === normalized);

        if (!exists) {
            memory.push({
                id: Date.now(),
                text: memoryText,
                createdAt: new Date().toISOString()
            });

            writeMemory(memory);
        }

        return {
            handled: true,
            answer: "Bunu hatırlayacağım: " + memoryText,
            memory
        };
    }

    return { handled: false };
}

function getMemoryContext() {
    const memory = readMemory();

    if (!memory.length) {
        return "Kayıtlı kalıcı hafıza yok.";
    }

    return memory
        .slice(-15)
        .map((item, index) => `${index + 1}. ${item.text}`)
        .join("\n");
}

async function askTars(message, personality = {}) {
    const prompt = `/no_think
Sen HeyT.A.R.S adlı Türkçe konuşan yerel yapay zeka asistansın.
ChatGPT benzeri yazışmalı moddasın ama kimliğin HeyT.A.R.S olarak kalacak.
OpenAI kullanmıyorsun; Ollama üzerinde yerel çalışıyorsun.
Kısa, net, yardımcı, robotik ve hafif kuru mizahlı konuş.
Filmdeki karakteri birebir taklit etme; özgün TARS-benzeri bir yardımcı ol.

Kişilik ayarları:
- Espri seviyesi: ${personality.humor || 65}%
- Dürüstlük: ${personality.honesty || 90}%
- Resmiyet: ${personality.formality || 40}%
- Alaycılık: ${personality.sarcasm || 55}%
- Sabır: ${personality.patience || 75}%

Kalıcı hafıza:
${getMemoryContext()}

Kurallar:
- Hafızadaki bilgileri kullanıcıya yardımcı olmak için kullan.
- Emin olmadığın şeyi uydurma.
- Cevabını genelde 1-5 cümle tut.
- Gereksiz uzun konuşma.
- Kullanıcı isterse detaylandır.

Kullanıcı mesajı:
${String(message || "Merhaba")}

HeyT.A.R.S cevabı:
`;

    let response;

    try {
        response = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt,
                stream: false,
                think: false,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: 240
                }
            })
        });
    } catch {
        throw new Error("Ollama bağlantısı kurulamadı. Ollama açık mı kontrol et.");
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Ollama API hatası.");
    }

    const answer = String(data.response || "").trim();

    if (answer) return answer;

    return "Cevap üretemedim. Yerel model kısa süreliğine fazla düşündü.";
}

const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/memory") {
        sendJson(res, 200, {
            memory: readMemory()
        });
        return;
    }

    if (req.method === "POST" && req.url === "/api/memory/clear") {
        writeMemory([]);
        sendJson(res, 200, {
            memory: []
        });
        return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
        try {
            const body = JSON.parse(await readBody(req));
            const memoryCommand = handleMemoryCommand(body.message);

            if (memoryCommand.handled) {
                sendJson(res, 200, {
                    answer: memoryCommand.answer,
                    provider: "memory",
                    model: "local-memory",
                    memory: memoryCommand.memory
                });
                return;
            }

            const answer = await askTars(body.message, body.personality || {});

            sendJson(res, 200, {
                answer,
                provider: "ollama",
                model: OLLAMA_MODEL,
                memory: readMemory()
            });
        } catch (error) {
            sendJson(res, 500, {
                error: error.message
            });
        }

        return;
    }

    const safeUrl = req.url === "/"
        ? "/index.html"
        : decodeURIComponent(req.url.split("?")[0]);

    const filePath = path.normalize(path.join(__dirname, safeUrl));

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end("Erişim reddedildi.");
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Dosya bulunamadı.");
            return;
        }

        const ext = path.extname(filePath).toLowerCase();

        const types = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8"
        };

        res.writeHead(200, {
            "Content-Type": types[ext] || "application/octet-stream"
        });

        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`HeyT.A.R.S Chat çalışıyor: http://localhost:${PORT}`);
    console.log(`AI sağlayıcı: Ollama`);
    console.log(`AI modeli: ${OLLAMA_MODEL}`);
});