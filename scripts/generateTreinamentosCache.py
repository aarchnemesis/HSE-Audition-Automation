import json
import urllib.request
import urllib.parse
import os
import re
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

TOKEN_PATH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/google_oauth_token.json'
CLIENT_PATH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/google_oauth_client.json'
OUTPUT_DATA = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/data/drive_inspectors_cache.json'
OUTPUT_SCRATCH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/drive_inspectors_cache.json'

BRANCHES = [
    ('1_0FUXX-hML_DOsYrakRxIBFq2a8w1lbB', '01 - Inspetores de Qualidade & Técnicos de Operações'),
    ('1eKTeGTWnwWl8Y2ND5wBKCLUK3ArxUwls', '02 - Líderes & EHS'),
    ('1xqXRRSN0Tapg_ACW9-kJhE0qRi4m_lZa', '03 - Drone Insp. Equipamento'),
    ('13Ot7fK8gotTYlLAZm0V9WtGbG0aRiBSI', '04 - LPS - SPDA'),
]

BRANCH_CODE_REMAP = {
    '1xqXRRSN0Tapg_ACW9-kJhE0qRi4m_lZa': {
        '04': '40', '04.1': '40.1', '07': '08', '08': '09', '09': '10',
        '10': '11', '11': '16', '14': '18', '15': '19', '16': '15', '16.1': '15.1'
    },
    '13Ot7fK8gotTYlLAZm0V9WtGbG0aRiBSI': {
        '04': '40', '04.1': '40.1'
    }
}

EXCLUDED_FOLDER_NAMES = {
    '1xqXRRSN0Tapg_ACW9-kJhE0qRi4m_lZa': ['outros'],
    '13Ot7fK8gotTYlLAZm0V9WtGbG0aRiBSI': ['outros']
}

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

def list_children(folder_id, access_token):
    files = []
    page_token = None
    while True:
        query = f"'{folder_id}' in parents and trashed = false"
        params = {
            'q': query,
            'pageSize': 1000,
            'supportsAllDrives': 'true',
            'includeItemsFromAllDrives': 'true',
            'fields': 'nextPageToken, files(id, name, mimeType, modifiedTime)'
        }
        if page_token:
            params['pageToken'] = page_token
        url = f"https://www.googleapis.com/drive/v3/files?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {access_token}'})
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                files.extend(data.get('files', []))
                page_token = data.get('nextPageToken')
                if not page_token:
                    break
        except Exception as e:
            print(f"Error listing children for {folder_id}: {e}")
            break
    return files

DOC_PATTERNS = [
    ('40.1', r'(?:DOC\s*40\.1|40\.1|ADITIVO)', 0),
    ('40',   r'(?:DOC\s*40|40|CONTRATO)', 0),
    ('01',   r'(?:DOC\s*01|01|ASO)', 365),
    ('02',   r'(?:DOC\s*02|02|ORDEM\s*DE\s*SERVI[CÇ]O|OS)', 365),
    ('03',   r'(?:DOC\s*03|03|FICHA\s*DE\s*EPI)', 365),
    ('07',   r'(?:DOC\s*07|07|CNH)', 1825),
    ('08',   r'(?:DOC\s*08|08|DIRE[CÇ][AÃ]O\s*DEFENSIVA)', 730),
    ('09',   r'(?:DOC\s*09|09|NR[-_\s]*01)', 730),
    ('10',   r'(?:DOC\s*10|10|NR[-_\s]*06)', 365),
    ('11',   r'(?:DOC\s*11|11|NR[-_\s]*10\s*SEP)', 730),
    ('12',   r'(?:DOC\s*12|12|NR[-_\s]*10\s*B[AÁ]SICO)', 730),
    ('13',   r'(?:DOC\s*13|13|NR[-_\s]*35)', 730),
    ('14',   r'(?:DOC\s*14|14|NR[-_\s]*12)', 730),
    ('15',   r'(?:DOC\s*15|15|NR[-_\s]*33)', 365),
    ('16',   r'(?:DOC\s*16|16|PRIMEIROS\s*SOCORROS|GWO\s*FA)', 730),
    ('17',   r'(?:DOC\s*17|17|TRABALHO\s*EM\s*ALTURA|GWO\s*WAH)', 730),
    ('18',   r'(?:DOC\s*18|18|MANUSEIO\s*DE\s*CARGAS|GWO\s*MH)', 730),
    ('19',   r'(?:DOC\s*19|19|COMBATE\s*A\s*INC[EÊ]NDIO|GWO\s*FAW)', 730),
    ('20',   r'(?:DOC\s*20|20|ACESSO\s*POR\s*CORDAS|ABENDI|IRATA)', 1095),
    ('21',   r'(?:DOC\s*21|21|OPERA[CÇ][AÃ]O\s*DE\s*GUINCHO)', 730),
    ('22',   r'(?:DOC\s*22|22|PLATAFORMA\s*ELEVAT[OÓ]RIA|PEMT)', 730),
    ('23',   r'(?:DOC\s*23|23|TALHA)', 730),
    ('24',   r'(?:DOC\s*24|24|PTE)', 730),
    ('25',   r'(?:DOC\s*25|25|RIGGER)', 730),
    ('26',   r'(?:DOC\s*26|26|GWO\s*BTT)', 0),
    ('27',   r'(?:DOC\s*27|27|GWO\s*ART)', 730),
    ('28',   r'(?:DOC\s*28|28|GWO\s*SLS)', 730),
    ('30',   r'(?:DOC\s*30|30|RAC[-_\s]*01)', 730),
    ('31',   r'(?:DOC\s*31|31|RAC[-_\s]*02)', 730),
    ('32',   r'(?:DOC\s*32|32|RAC[-_\s]*03)', 730),
]

def parse_doc(filename, remap=None):
    clean = filename.upper()
    
    # Try exact leading code match: "16 - ", "01. ", "40.1 - "
    leading_match = re.match(r'^([0-9]{2}(?:\.[0-9])?)\b', clean)
    code = None
    if leading_match:
        code = leading_match.group(1)
    else:
        for c, pat, _ in DOC_PATTERNS:
            if re.search(pat, clean):
                code = c
                break

    if code and remap and code in remap:
        code = remap[code]

    # Try date extraction: DD.MM.YYYY, DD_MM_YYYY, DD-MM-YYYY, YYYY-MM-DD
    date_match = re.search(r'(\d{2})[.\-_/](\d{2})[.\-_/](\d{4})', filename)
    exp_date = None
    issue_date = None
    if date_match:
        d, m, y = date_match.groups()
        try:
            parsed = datetime.datetime(int(y), int(m), int(d))
            # Assume date in filename is expiration if >= 2024, or issue date if older
            if parsed.year >= 2025:
                exp_date = parsed
            else:
                issue_date = parsed
                # find validity period
                for c, _, days in DOC_PATTERNS:
                    if c == code and days > 0:
                        exp_date = issue_date + datetime.timedelta(days=days)
                        break
        except:
            pass

    return code, issue_date, exp_date

def scan_collaborator(collab_folder, branch_id, access_token):
    collab_id = collab_folder['id']
    folder_name = collab_folder['name']

    name_parts = re.split(r'[-–—_]', folder_name)
    name = name_parts[0].strip()
    role = ' - '.join(name_parts[1:]).strip() if len(name_parts) > 1 else 'TÉCNICO / INSPETOR'

    remap = BRANCH_CODE_REMAP.get(branch_id, {})
    excluded = EXCLUDED_FOLDER_NAMES.get(branch_id, [])

    certificates = {}

    def scan_recursive(fid):
        children = list_children(fid, access_token)
        for item in children:
            iname = item.get('name', '')
            imime = item.get('mimeType', '')
            iid = item.get('id', '')

            if imime == 'application/vnd.google-apps.folder':
                lower = iname.lower().strip()
                if re.search(r'obsolet|obesoleto|0bsoleto|^00\.', lower):
                    continue
                if any(ex in lower for ex in excluded):
                    continue
                scan_recursive(iid)
                continue

            if iname.lower().endswith('.pdf') or imime == 'application/pdf':
                code, issue, exp = parse_doc(iname, remap)
                if not code:
                    continue

                status = 'INDETERMINADO'
                detail = ''
                now = datetime.datetime.now()
                if exp:
                    diff = (exp - now).days
                    if diff < 0:
                        status = 'VENCIDO'
                        detail = f'Venceu em {exp.strftime("%d/%m/%Y")}'
                    elif diff <= 30:
                        status = 'VENCE_30'
                        detail = f'Vence em {diff} dias ({exp.strftime("%d/%m/%Y")})'
                    else:
                        status = 'CONFORME'
                        detail = f'Valido ate {exp.strftime("%d/%m/%Y")}'

                cert_obj = {
                    'code': code,
                    'name': f'Doc {code}',
                    'filename': iname,
                    'issueDate': issue.isoformat() if issue else None,
                    'expirationDate': exp.isoformat() if exp else None,
                    'statusEHS': status,
                    'statusDetail': detail,
                    'sourcePath': f'https://drive.google.com/file/d/{iid}/view'
                }

                existing = certificates.get(code)
                if not existing:
                    certificates[code] = cert_obj
                else:
                    if exp:
                        exist_exp = existing.get('expirationDate')
                        if not exist_exp or exp.isoformat() > exist_exp:
                            certificates[code] = cert_obj

    scan_recursive(collab_id)

    return {
        'id': collab_id,
        'name': name,
        'role': role,
        'driveFolderId': collab_id,
        'driveFolderUrl': f'https://drive.google.com/drive/folders/{collab_id}',
        'certificates': certificates
    }

def main():
    print('>>> Obtendo token de acesso...')
    access_token = get_valid_token()

    all_inspectors = []

    for branch_id, branch_name in BRANCHES:
        print(f'\n>>> Lendo ramo: {branch_name} ({branch_id})...')
        children = list_children(branch_id, access_token)
        collab_folders = [
            f for f in children 
            if f.get('mimeType') == 'application/vnd.google-apps.folder' 
            and not re.search(r'obsolet|obesoleto|0bsoleto|^00\.', f.get('name', '').lower().strip())
        ]
        print(f'   {len(collab_folders)} pasta(s) de colaboradores encontradas no ramo.')

        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {
                executor.submit(scan_collaborator, folder, branch_id, access_token): folder['name']
                for folder in collab_folders
            }
            for future in as_completed(futures):
                fname = futures[future]
                try:
                    res = future.result()
                    all_inspectors.append(res)
                    print(f'   + [{len(res["certificates"])} docs] {res["name"]} -> {res["driveFolderUrl"]}')
                except Exception as e:
                    print(f'   ! Erro ao escanear {fname}: {e}')

    print(f'\n>>> Total de colaboradores escaneados: {len(all_inspectors)}')

    for out_path in [OUTPUT_DATA, OUTPUT_SCRATCH]:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(all_inspectors, f, indent=2, ensure_ascii=False)
        print(f'Salvo em: {out_path}')

if __name__ == '__main__':
    main()
