# Meter gateway

A small program that runs on a PC or a Raspberry Pi in the plant, reads the furnace's energy meter over **Modbus TCP** once a minute, and pushes the readings to EnergyOS at `/api/ingest`. It has no dependencies beyond Node.js 22.

- **Read-only.** It only uses Modbus function 3 or 4 (read registers). It cannot write to the meter or to any equipment.
- **Nothing lost offline.** Every reading goes to a local file first (`gateway-buffer.jsonl`). If the internet or the server is down, readings wait there and are sent, oldest first, when it is back. A reading leaves the file only after the server has answered 2xx.
- **Counter, not just power.** It sends the meter's cumulative kWh register, so the server computes each interval's energy from the counter difference. A missed minute does not lose energy.

Tested end to end against a simulated meter and the real ingest code: `tests/integration/gateway.test.ts`.

## 1. Get a meter token

In EnergyOS: **Settings → Meters → Issue ingest token** (owner only). Copy it once; it is not shown again.

## 2. Find the meter's registers

Take the addresses from the meter's **Modbus register map** in its manual. Look for:

| What | Usually called | Typical type |
|---|---|---|
| Total active power | "Total kW", "Active Power Total" | float32 |
| Active energy import | "kWh import", "Wh received", "Active Energy Total" | float32, or uint32 with a scale |

Notes:
- Manuals often list addresses starting at 1 or 40001. The gateway uses **zero-based** addresses: 40001 → 0, 3901 → 3900.
- If a value reads as nonsense, try `"wordOrder": "CDAB"` (some meters swap the two 16-bit halves).
- A uint32 in Wh needs `"scale": 0.001` to give kWh.

## 3. Configure

Copy `config.example.json` to `config.json` and fill in:

```json
{
  "url": "https://factorytwin-energyos.onrender.com/api/ingest",
  "token": "eos_…",
  "meter": { "host": "192.168.1.50", "port": 502, "unitId": 1, "intervalSeconds": 60, "utcOffset": "+05:30" },
  "power":  { "function": 3, "address": 0, "type": "float32" },
  "energy": { "function": 3, "address": 2, "type": "float32" },
  "bufferFile": "gateway-buffer.jsonl"
}
```

`intervalSeconds` must match the meter's interval in EnergyOS. For an RS-485 (Modbus RTU) meter, put a Modbus TCP-to-RTU converter in front of it and point `host` at the converter.

## 4. Run

```bash
node --experimental-strip-types gateway/main.ts gateway/config.json
```

Each minute it logs one line, for example
`2026-11-18T09:15:00+05:30 512.3 kW 104008.5 kWh · sent 1, waiting 0`.

### Keep it running (Linux, systemd)

```ini
# /etc/systemd/system/energyos-gateway.service
[Unit]
Description=EnergyOS meter gateway
After=network-online.target

[Service]
WorkingDirectory=/opt/energyos
ExecStart=/usr/bin/node --experimental-strip-types gateway/main.ts gateway/config.json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now energyos-gateway
```

## Errors

| Message | Meaning |
|---|---|
| `Modbus exception 2` | Wrong register address for this meter |
| `timed out` / `ECONNREFUSED` | Meter or converter not reachable on the plant network |
| `HTTP 401` | Token wrong or revoked; issue a new one. Readings stay in the buffer. |
| `HTTP 429` | Sending too fast; it retries next minute |
