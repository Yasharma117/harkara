# Morning checklist

Built overnight (all committed locally; tests green):
- **Cycle 0**: engine, couriers, cipher, scripted generals, 2D viewer. Gate passed on 3 seeds.
- **Cycle 1 code**: model generals for Groq / NVIDIA NIM / OpenRouter / local llama.cpp (`engine/model.ts`, `engine/providers.json`), one retry on bad JSON, rate limits, fallback chain, checkpoint + resume (verified byte-identical). Not yet run against a real model: needs the Oracle box and keys.
- **Oracle deploy**: `deploy/cloud-init.yaml`, `harkara-setup`, nightly timer at 02:00 IST, battles pushed to `battle/<id>` branches for review. Rehearsed end to end against a local fake repo + fake model.
- **Cycle 2 prep**: three.js diorama (Map / Diorama toggle), house tint in a TSL shader, placeholder art; `npm run assets` pipeline for your PNGs; `assets/map-mask.png` for batch 4.

## 1. Push the repo (blocked for me last night by the permission system)

    ! gh repo create Yasharma117/harkara --private --source ~/otherfm/harkara --push

## 2. Art (batches 1–3)
Drop the PNGs in `harkara/assets/raw/` (or attach them in chat). I run `npm run assets`, check the warnings, and wire them in.

## 3. Oracle box (cycle 1)
1. Sign up at cloud.oracle.com, home region **India West (Mumbai)** or **India South (Hyderabad)**. It asks for a card to verify.
2. Compute → Instances → Create: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex, 2 OCPU, 12 GB**. Under "Add SSH keys" keep "Generate a key pair" and **download the private key**. Under Advanced options → Management → paste all of `deploy/cloud-init.yaml`.
3. Make a GitHub fine-grained token: github.com → Settings → Developer settings → Fine-grained tokens → only repo `harkara`, permission Contents: read and write.
4. Get free keys: console.groq.com/keys, build.nvidia.com (API key), openrouter.ai/keys.
5. Open Cloud Shell (top right `>_` in the Oracle console), upload the private key, then
   `ssh -i <key> ubuntu@<public IP>` and run `harkara-setup`. It asks for the token and keys (hidden input) and pings every model.
   Paste me the output of that check (it never prints keys) and I'll fix any wrong model ids in `engine/providers.json`.

## Known gaps
- Model ids marked VERIFY in `providers.json` come from the spec and are unconfirmed.
- The box is only busy during the nightly battle; Oracle may reclaim idle A1 boxes after 7 days. The local ladder model (cycle 5) is the real fix; until then check the box weekly.
- Vercel import waits for cycle 5.
