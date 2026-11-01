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

## 4. Launch (cycle 5)
1. **Oracle ports.** In the Oracle console: Networking → your VCN → Security Lists → Default → Add Ingress Rules: source `0.0.0.0/0`, TCP, destination ports `80,443`. (The box's own firewall is opened by cloud-init.)
2. Run `harkara-setup` on the box. At the end it prints the ladder API address, e.g. `https://129-154-1-2.sslip.io`. Free HTTPS, no domain needed.
3. **Vercel.** vercel.com → Add New → Project → import `Yasharma117/harkara`. Settings come from `vercel.json`; leave them. Under Environment Variables add `VITE_LADDER_API` = the address from step 2. Deploy.
4. Send me the Vercel URL. I set it as the API's allowed origin and run the first ladder night.

## What runs every night on the box (02:00 IST)
1. The daily battle with the four model generals (Groq / NVIDIA / OpenRouter, local model as fallback).
2. The Doctrine Ladder: tonight's entries, every house on the local Gemma 4 E4B, so only the doctrines differ.
3. Every new battle is voiced (one voice per general).
4. All of it is pushed to `battle/<date>` for review; merge it to publish (Vercel redeploys on merge).

## Known gaps
- Voice: the nightly voices each new battle with Kokoro-82M on the CPU (`node tools/voice.ts <battle>` by hand). Listen to a few and tell me if it sounds cheap; the spec says drop it if so.
