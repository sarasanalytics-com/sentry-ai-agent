#!/bin/bash
# Test GitHub webhook locally

echo "Testing GitHub webhook..."

curl -X POST http://localhost:3000/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-Hub-Signature-256: sha256=$(echo -n '{"zen":"Testing webhook"}' | openssl dgst -sha256 -hmac "74c97313a2971703a72f73e29c9368f245f0689a64f4594ad4ed24775ff748c4" | cut -d' ' -f2)" \
  -d '{"zen":"Testing webhook","hook_id":12345}'

echo -e "\n\nCheck server logs for webhook received message"
