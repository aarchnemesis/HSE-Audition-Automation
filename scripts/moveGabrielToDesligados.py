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

# Gabriel folder: 1WlnNfApD5GYT2eIFxAdFkcl5Ph3Uujla
# Desligados folder: 1HgvCqXq6AwyKo8B6mRPh5XJbZjM-g4Ex
# Branch 01 folder: 1_0FUXX-hML_DOsYrakRxIBFq2a8w1lbB

folder_id = '1WlnNfApD5GYT2eIFxAdFkcl5Ph3Uujla'
add_parents = '1HgvCqXq6AwyKo8B6mRPh5XJbZjM-g4Ex'
remove_parents = '1_0FUXX-hML_DOsYrakRxIBFq2a8w1lbB'

url = f'https://www.googleapis.com/drive/v3/files/{folder_id}?addParents={add_parents}&removeParents={remove_parents}&supportsAllDrives=true&fields=id,name,parents'
req = urllib.request.Request(url, method='PATCH', headers={'Authorization': f'Bearer {token}'})

try:
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        print('Pasta do Gabriel movida com sucesso para DESLIGADOS:')
        print(res)
except Exception as e:
    print('Erro ao mover pasta:', e)
