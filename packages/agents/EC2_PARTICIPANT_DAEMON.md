# EC2 Participant Daemon (A/B/C)

Goal: run 3 participant bots on 3 EC2 instances that continuously submit allocation claims to the relayer.

## Prereqs
- Ubuntu 22.04+ with outbound internet
- Node 20+
- The strategy bot already registered these participant bots in relayer (`POST /bots/register`), using their `BOT_ID` + `PARTICIPANT_ADDRESS`.

## Repo Install (recommended)
```bash
sudo apt-get update -y
sudo apt-get install -y git curl

# Node (pick one: nvm or apt)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

git clone https://github.com/wiimdy/openfunderse.git
cd openfunderse
npm install
npm -w @wiimdy/openfunderse-agents run build
```

## Env Files
Copy one of:
- `packages/agents/systemd/env/participant-A.env.example`
- `packages/agents/systemd/env/participant-B.env.example`
- `packages/agents/systemd/env/participant-C.env.example`

Create runtime env folder:
```bash
mkdir -p /home/ubuntu/openfunderse/env
```

Write per-instance env file:
- `/home/ubuntu/openfunderse/env/participant-A.env`
- `/home/ubuntu/openfunderse/env/participant-B.env`
- `/home/ubuntu/openfunderse/env/participant-C.env`

## systemd Service
Install the unit template:
```bash
sudo cp packages/agents/systemd/openfunderse-participant-daemon@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Enable and start one instance:
```bash
sudo systemctl enable --now openfunderse-participant-daemon@A
```

Logs:
```bash
sudo journalctl -u openfunderse-participant-daemon@A -f
```

## Local one-shot sanity check (before systemd)
```bash
cd /home/ubuntu/openfunderse
set -a; source /home/ubuntu/openfunderse/env/participant-A.env; set +a
node packages/agents/dist/index.js participant-daemon --fund-id "$FUND_ID" --strategy "$PARTICIPANT_STRATEGY" --once --submit
```

