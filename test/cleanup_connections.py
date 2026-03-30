"""
Cleanup script: Deletes all stale connections from both Holder and Issuer agents.
Run this before each test to ensure a clean slate.
"""
import requests

HOLDER_URL = 'http://localhost:8031'
ISSUER_URL = 'http://localhost:8001'

holder_conns = requests.get(f'{HOLDER_URL}/connections').json()['results']
issuer_conns = requests.get(f'{ISSUER_URL}/connections').json()['results']

print(f'Holder connections to delete: {len(holder_conns)}')
print(f'Issuer connections to delete: {len(issuer_conns)}')

for c in holder_conns:
    cid = c['connection_id']
    r = requests.delete(f'{HOLDER_URL}/connections/{cid}')
    print(f'  Holder deleted {cid[:8]}... ({c["state"]}) -> {r.status_code}')

for c in issuer_conns:
    cid = c['connection_id']
    r = requests.delete(f'{ISSUER_URL}/connections/{cid}')
    print(f'  Issuer deleted {cid[:8]}... ({c["state"]}) -> {r.status_code}')

# Verify
h_remaining = requests.get(f'{HOLDER_URL}/connections').json()['results']
i_remaining = requests.get(f'{ISSUER_URL}/connections').json()['results']
print(f'Remaining - Holder: {len(h_remaining)}, Issuer: {len(i_remaining)}')
print('Cleanup done!')
