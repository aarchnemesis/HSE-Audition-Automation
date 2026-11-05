import json
import urllib.request
import urllib.parse

TOKEN_PATH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/google_oauth_token.json'
CLIENT_PATH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/google_oauth_client.json'

def get_valid_token():
    with open(TOKEN_PATH, 'r', encoding='utf-8') as f:
        t = json.load(f)
    with open(CLIENT_PATH, 'r', encoding='utf-8') as f:
        c = json.load(f)
        creds = c.get('installed') or c.get('web')

    refresh_token = t.get('refresh_token')
    client_id = creds.get('client_id')
    client_secret = creds.get('client_secret')

    refresh_url = 'https://oauth2.googleapis.com/token'
    data = urllib.parse.urlencode({
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token,
        'grant_type': 'refresh_token'
    }).encode('utf-8')

    req = urllib.request.Request(refresh_url, data=data)
    with urllib.request.urlopen(req) as resp:
        new_token_data = json.loads(resp.read().decode('utf-8'))
        t['access_token'] = new_token_data['access_token']

    with open(TOKEN_PATH, 'w', encoding='utf-8') as f:
        json.dump(t, f, indent=2)

    return t['access_token']

token = get_valid_token()

# Pastas do Thiago Lima
# Root Thiago: 1PnZG2YSzXctX3aY1KuOef7R76AFQfPib
# 01. Documentos Pessoais: 1rCoFLG26ZGGHqfe7U08UdGH3pqPcUYWs
# 00. Obsoletos: 1FM9khrd6feFZjDchQgZrFIP_8x7kzaVO

# Arquivo 1: Contrato + Aditivo solto na raiz (28 págs) -> Mover para 01. Documentos Pessoais
# ID: 1yE0qMQxOFqCWMkHe2IZMvsWStrMCuJa_
fid_contrato = '1yE0qMQxOFqCWMkHe2IZMvsWStrMCuJa_'
url = f'https://www.googleapis.com/drive/v3/files/{fid_contrato}?addParents=1rCoFLG26ZGGHqfe7U08UdGH3pqPcUYWs&removeParents=1PnZG2YSzXctX3aY1KuOef7R76AFQfPib&supportsAllDrives=true'
req = urllib.request.Request(url, method='PATCH', headers={'Authorization': f'Bearer {token}'})
try:
    with urllib.request.urlopen(req) as resp:
        print('Contrato (28 págs) movido para 01. Documentos Pessoais com sucesso.')
except Exception as e:
    print('Erro ao mover contrato:', e)

# Arquivo 2: Falso Contrato 40 (recibo da segunda via de 2 págs) -> Renomear ou Mover para Obsoletos
# ID: 16kjAekFmuGUk0W7jczTAvqUTi04DwH4V
# Mover de 01. Documentos Pessoais para 00. Obsoletos
fid_recibo = '16kjAekFmuGUk0W7jczTAvqUTi04DwH4V'
url2 = f'https://www.googleapis.com/drive/v3/files/{fid_recibo}?addParents=1FM9khrd6feFZjDchQgZrFIP_8x7kzaVO&removeParents=1rCoFLG26ZGGHqfe7U08UdGH3pqPcUYWs&supportsAllDrives=true'
req2 = urllib.request.Request(url2, method='PATCH', headers={'Authorization': f'Bearer {token}'})
try:
    with urllib.request.urlopen(req2) as resp:
        print('Recibo de 2ª via movido para 00. Obsoleto com sucesso.')
except Exception as e:
    print('Erro ao mover recibo:', e)
