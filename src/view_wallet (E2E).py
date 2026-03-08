import json
import requests
import webbrowser
import os
import datetime

HOLDER_URL = "http://localhost:8031"

def api_get(url):
    try:
        return requests.get(url).json()
    except Exception as e:
        print(f"Error fetching from {url}: {e}")
        return {"results": []}

def build_html():
    print("Fetching Wallet Data from Holder Agent...")
    
    # 1. Fetch Connections
    conns = api_get(f"{HOLDER_URL}/connections").get('results', [])
    active_conns = [c for c in conns if c.get('state') == 'active']
    
    # 2. Fetch Credentials
    creds = api_get(f"{HOLDER_URL}/credentials").get('results', [])
    
    # 3. Create HTML Content
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Holder Digital Wallet</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root {{
                --bg-color: #f3f4f6;
                --text-main: #1f2937;
                --card-bg: #ffffff;
                --primary: #3b82f6;
                --success: #10b981;
            }}
            body {{
                font-family: 'Inter', sans-serif;
                background-color: var(--bg-color);
                color: var(--text-main);
                margin: 0;
                padding: 40px 20px;
                display: flex;
                justify-content: center;
            }}
            .container {{
                max-width: 800px;
                width: 100%;
            }}
            .header {{
                text-align: center;
                margin-bottom: 40px;
            }}
            .header h1 {{
                font-size: 2.5rem;
                margin: 0;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            .header p {{
                color: #6b7280;
                margin-top: 10px;
            }}
            .section-title {{
                font-size: 1.5rem;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                gap: 10px;
            }}
            .card-grid {{
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                gap: 20px;
                margin-bottom: 40px;
            }}
            .card {{
                background: var(--card-bg);
                border-radius: 16px;
                padding: 24px;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                transition: transform 0.2s;
                position: relative;
                overflow: hidden;
            }}
            .card::before {{
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; height: 4px;
            }}
            .card:hover {{
                transform: translateY(-5px);
            }}
            
            /* Credential Specific */
            .credential-card::before {{ background: linear-gradient(90deg, #10b981, #34d399); }}
            .credential-header {{
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 20px;
            }}
            .credential-title {{
                font-weight: 700;
                font-size: 1.25rem;
                color: #111827;
                margin: 0;
            }}
            .credential-schema {{
                font-size: 0.85rem;
                color: #6b7280;
                word-break: break-all;
            }}
            .attr-row {{
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #f3f4f6;
            }}
            .attr-row:last-child {{ border-bottom: none; }}
            .attr-name {{ color: #6b7280; font-size: 0.9rem; text-transform: capitalize; }}
            .attr-value {{ font-weight: 500; font-size: 0.95rem; }}
            
            /* Connection Specific */
            .connection-card::before {{ background: linear-gradient(90deg, #3b82f6, #60a5fa); }}
            .conn-status {{
                display: inline-block;
                padding: 4px 12px;
                background-color: #d1fae5;
                color: #065f46;
                border-radius: 20px;
                font-size: 0.75rem;
                font-weight: 600;
                text-transform: uppercase;
                margin-bottom: 10px;
            }}
            .conn-label {{
                font-size: 1.25rem;
                font-weight: 600;
                margin: 0 0 5px 0;
            }}
            .conn-id {{
                font-size: 0.8rem;
                color: #9ca3af;
            }}
            
            .empty-state {{
                background: var(--card-bg);
                padding: 40px;
                border-radius: 16px;
                text-align: center;
                color: #6b7280;
                border: 2px dashed #d1d5db;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>✨ Mobile Wallet Dashboard</h1>
                <p>Generated on {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</p>
            </div>
            
            <h2 class="section-title">🎓 My Verified Credentials ({len(creds)})</h2>
            """
            
    if not creds:
        html_content += """
        <div class="empty-state">
            <h3>No Credentials Found</h3>
            <p>You haven't received any Verifiable Credentials yet. Run the E2E script first!</p>
        </div>
        """
    else:
        html_content += '<div class="card-grid">'
        for c in creds:
            attrs = c.get('attrs', {})
            schema_id = c.get('schema_id', 'Unknown Schema')
            
            html_content += f"""
            <div class="card credential-card">
                <div class="credential-header">
                    <div>
                        <h3 class="credential-title">Verified Identity</h3>
                        <span class="credential-schema">{schema_id}</span>
                    </div>
                    <span style="font-size: 2rem;">🛡️</span>
                </div>
                <div class="attributes">
            """
            for k, v in attrs.items():
                html_content += f"""
                    <div class="attr-row">
                        <span class="attr-name">{k.replace('_', ' ')}</span>
                        <span class="attr-value">{v}</span>
                    </div>
                """
            html_content += """
                </div>
            </div>
            """
        html_content += '</div>'

    html_content += f"""
            <h2 class="section-title">🤝 Active Connections ({len(active_conns)})</h2>
    """
    
    if not active_conns:
        html_content += """
        <div class="empty-state">
            <h3>No Connections Found</h3>
            <p>You haven't established any DIDComm connections yet.</p>
        </div>
        """
    else:
        html_content += '<div class="card-grid">'
        for c in active_conns:
            html_content += f"""
            <div class="card connection-card">
                <span class="conn-status">Active</span>
                <h3 class="conn-label">{c.get('their_label', 'Unknown Agent')}</h3>
                <p class="conn-id">DID: {c.get('their_did', 'N/A')}</p>
                <p class="conn-id" style="margin-top:-10px;">ID: {c.get('connection_id')}</p>
            </div>
            """
        html_content += '</div>'

    html_content += """
        </div>
    </body>
    </html>
    """

    filepath = os.path.abspath("wallet_dashboard.html")
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(html_content)
    
    print(f"✅ Dashboard generated successfully!")
    print(f"Opening {filepath} in your default browser...")
    webbrowser.open(f"file://{filepath}")

if __name__ == "__main__":
    build_html()
