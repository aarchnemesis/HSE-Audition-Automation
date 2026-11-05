import json
import urllib.request
import urllib.parse
import os
import re
import datetime
import pypdf
import io
from concurrent.futures import ThreadPoolExecutor, as_completed

TOKEN_PATH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/google_oauth_token.json'
CLIENT_PATH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/google_oauth_client.json'
PDF_CACHE_PATH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/data/pdf_content_cache.json'
OUTPUT_DATA = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/data/drive_inspectors_cache.json'
OUTPUT_SCRATCH = 'C:/Users/Arthwind/Documents/GitHub/HSE-Audition-Automation/scratch/drive_inspectors_cache.json'

REF_DATE = datetime.datetime(2026, 11, 5)

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

ANNUAL_VALIDITY_CODES = ['01', '06', '20', '28', '34']
EVENT_TRIGGERED_ONLY_CODES = ['02', '03', '04', '05', '10', '11', '23', '24', '30']
EVENT_TRIGGERED_VALIDITY_YEARS = 50
DIRECT_EXPIRATION_CODES = ['40', '40.1']
TEN_YEAR_VALIDITY_CODES = ['08']

DOC_CLASSIFICATION_RULES = [
    ('40.1', r'(?:DOC\s*40\.1|40\.1|ADITIVO)'),
    ('40',   r'(?:DOC\s*40|40|CONTRATO)'),
    ('01',   r'(?:DOC\s*01|01|ASO)'),
    ('02',   r'(?:DOC\s*02|02|ORDEM\s*DE\s*SERVI[CÇ]O|OS\b)'),
    ('03.1', r'(?:DOC\s*03\.1|03\.1|QSA|CNPJ)'),
    ('03',   r'(?:DOC\s*03|03|FICHA\s*DE\s*REGISTRO)'),
    ('04',   r'(?:DOC\s*04|04|CTPS)'),
    ('05.2', r'(?:DOC\s*05\.2|05\.2|PLANO\s*DE\s*SA[UÚ]DE)'),
    ('05',   r'(?:DOC\s*05|05|CART[AÃ]O\s*DE\s*VACINA|VACINA)'),
    ('06',   r'(?:DOC\s*06|06|FICHA\s*DE\s*EPI)'),
    ('07',   r'(?:DOC\s*07|07|SEGURO\s*DE\s*VIDA)'),
    ('08',   r'(?:DOC\s*08|08|CNH)'),
    ('09',   r'(?:DOC\s*09|09|DIRE[CÇ][AÃ]O\s*DEFENSIVA)'),
    ('10',   r'(?:DOC\s*10|10|NR[-_\s]*01)'),
    ('11',   r'(?:DOC\s*11|11|NR[-_\s]*06)'),
    ('12.1', r'(?:DOC\s*12\.1|12\.1|CARTA\s*NR[-_\s]*10)'),
    ('12',   r'(?:DOC\s*12|12|NR[-_\s]*10\s*B[AÁ]SICO)'),
    ('13',   r'(?:DOC\s*13|13|NR[-_\s]*10\s*SEP)'),
    ('14',   r'(?:DOC\s*14|14|NR[-_\s]*11|TALHA)'),
    ('15.1', r'(?:DOC\s*15\.1|15\.1|CARTA\s*NR[-_\s]*12)'),
    ('15',   r'(?:DOC\s*15|15|NR[-_\s]*12)'),
    ('16',   r'(?:DOC\s*16|16|PRIMEIROS\s*SOCORROS|GWO\s*FA\b)'),
    ('17',   r'(?:DOC\s*17|17|ERGONOMIA|CAR(?:GA)?\s*MANUAL|GWO\s*MH)'),
    ('18',   r'(?:DOC\s*18|18|NR[-_\s]*18)'),
    ('19',   r'(?:DOC\s*19|19|COMBATE\s*A\s*INC[EÊ]NDIO|GWO\s*FAW)'),
    ('20.1', r'(?:DOC\s*20\.1|20\.1|CARTA\s*NR[-_\s]*33)'),
    ('20',   r'(?:DOC\s*20|20|NR[-_\s]*33\s*ESP(?:A[CÇ]O)?\s*CONF(?:INADO)?|VIGIA)'),
    ('21.1', r'(?:DOC\s*21\.1|21\.1|CARTA\s*NR[-_\s]*35)'),
    ('21',   r'(?:DOC\s*21|21|NR[-_\s]*35|TRAB(?:ALHO)?\s*EM\s*ALTURA|GWO\s*WAH)'),
    ('22',   r'(?:DOC\s*22|22|LOTO|BLOQUEIO)'),
    ('23',   r'(?:DOC\s*23|23|CRT)'),
    ('24',   r'(?:DOC\s*24|24|DIPLOMA)'),
    ('25',   r'(?:DOC\s*25|25|SIT)'),
    ('26',   r'(?:DOC\s*26|26|ESO|BTT)'),
    ('27',   r'(?:DOC\s*27|27|NR[-_\s]*07|GWO\s*ART)'),
    ('28',   r'(?:DOC\s*28|28|NR[-_\s]*33\s*SUPERVISOR|SUPERVISOR)'),
    ('30',   r'(?:DOC\s*30|30|WINDA)'),
    ('31',   r'(?:DOC\s*31|31|ELEVADOR)'),
    ('32',   r'(?:DOC\s*32|32|ART\b)'),
]

# Carrega cache do PDFContentCache
PDF_CONTENT_CACHE = {}
if os.path.exists(PDF_CACHE_PATH):
    try:
        with open(PDF_CACHE_PATH, 'r', encoding='utf-8') as f:
            raw_cache = json.load(f)
            if isinstance(raw_cache, list):
                for item in raw_cache:
                    fid = item.get('fileId')
                    if fid:
                        PDF_CONTENT_CACHE[fid] = item
    except Exception as e:
        print('Aviso ao carregar pdf_content_cache:', e)

print(f'Cache de PDFs carregado: {len(PDF_CONTENT_CACHE)} entradas.')

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

def download_and_inspect_pdf(fid, access_token):
    url = f'https://www.googleapis.com/drive/v3/files/{fid}?alt=media&supportsAllDrives=true'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {access_token}'})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        reader = pypdf.PdfReader(io.BytesIO(data))
        text = ''
        for p in reader.pages[:5]:
            text += (p.extract_text() or '') + '\n'
        return text
    except:
        return ''

def parse_date_from_filename(filename):
    normalized = filename.replace('_', ' ')
    m = re.search(r'(?:^|\D)(\d{2})[\s\.\/-](\d{2})[\s\.\/-](\d{2,4})(?:\D|$)', normalized)
    if m:
        day = int(m.group(1))
        month = int(m.group(2))
        year = int(m.group(3))
        if year < 100: year += 2000
        if 1 <= month <= 12 and 1 <= day <= 31 and 1990 <= year <= 2050:
            try:
                return datetime.datetime(year, month, day)
            except:
                pass
    m2 = re.search(r'(?:^|\D)(\d{4})[\.\/-](\d{2})[\.\/-](\d{2})(?:\D|$)', normalized)
    if m2:
        year = int(m2.group(1))
        month = int(m2.group(2))
        day = int(m2.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31 and 1990 <= year <= 2050:
            try:
                return datetime.datetime(year, month, day)
            except:
                pass
    return None

def get_validity_years(code):
    if code in EVENT_TRIGGERED_ONLY_CODES: return EVENT_TRIGGERED_VALIDITY_YEARS
    if code in TEN_YEAR_VALIDITY_CODES: return 10
    if code in ANNUAL_VALIDITY_CODES: return 1
    return 2

def add_years(d, years):
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d + (datetime.date(d.year + years, 1, 1) - datetime.date(d.year, 1, 1))

def calculate_expiration(code, parsed_date, ref_date):
    if code in EVENT_TRIGGERED_ONLY_CODES:
        base = parsed_date or ref_date
        return add_years(base, EVENT_TRIGGERED_VALIDITY_YEARS)

    if not parsed_date:
        return None

    if code in DIRECT_EXPIRATION_CODES or parsed_date >= ref_date:
        return parsed_date

    years = get_validity_years(code)
    return add_years(parsed_date, years)

def evaluate_date(exp_date, ref_date):
    if not exp_date:
        return 'INDETERMINADO', ''
    diff = (exp_date - ref_date).days
    if diff < 0:
        return 'VENCIDO', f'VENCIDO há {abs(diff)} dias ({exp_date.strftime("%d/%m/%Y")})'
    elif diff <= 30:
        return 'VENCE_30', f'ALERTA MÉDIO: Vence em {diff} dias ({exp_date.strftime("%d/%m/%Y")})'
    elif diff <= 60:
        return 'VENCE_60', f'ALERTA INICIAL: Vence em {diff} dias ({exp_date.strftime("%d/%m/%Y")})'
    else:
        return 'CONFORME', f'Válido até {exp_date.strftime("%d/%m/%Y")}'

def classify_doc(filename, pdf_text="", remap=None):
    clean = filename.upper()
    upper_text = pdf_text.upper() if pdf_text else ""

    # Regra de exclusão de recibos e declarações acessórias de contrato
    if 'DECLARAÇÃO DE RECEBIMENTO' in clean or 'RECEBIMENTO DA SEGUNDA VIA' in clean or \
       'DECLARAÇÃO DE RECEBIMENTO' in upper_text or 'RECEBI UMA VIA DO CONTRATO' in upper_text:
        return None # É apenas recibo acessório, não contrato/habilitação

    # 1. Se houver inspeção de conteúdo em cache/texto
    if 'ATESTADO DE SAÚDE OCUPACIONAL' in upper_text or 'ASO' in upper_text and 'EXAME' in upper_text:
        return '01'
    if 'ORDEM DE SERVIÇO' in upper_text or 'ORDEM DE SERVICO' in upper_text:
        return '02'
    if 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS' in upper_text:
        if 'ADITIVO' in upper_text or 'TERMO ADITIVO' in upper_text or 'ADITIVO' in clean:
            return '40.1'
        return '40'
    if 'FICHA DE ENTREGA DE EQUIPAMENTO' in upper_text or 'FICHA DE EPI' in upper_text:
        return '06'
    if 'CARTEIRA NACIONAL DE HABILITAÇÃO' in upper_text or 'HABILITACAO' in upper_text:
        return '08'

    code = None
    m = re.match(r'^([0-9]{2}(?:\.[0-9])?)\b', clean)
    if m:
        code = m.group(1)
    else:
        for c, pat in DOC_CLASSIFICATION_RULES:
            if re.search(pat, clean):
                code = c
                break

    if code and remap and code in remap:
        code = remap[code]

    return code

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
                # 1. Checa se já temos inspeção de conteúdo em cache
                cached_pdf = PDF_CONTENT_CACHE.get(iid)
                pdf_text = ""
                exp_from_content = None
                code_from_content = None

                if cached_pdf:
                    code_from_content = cached_pdf.get('code')
                    if cached_pdf.get('expirationDate'):
                        try:
                            exp_from_content = datetime.datetime.fromisoformat(cached_pdf['expirationDate'].replace('Z', '+00:00')).replace(tzinfo=None)
                        except:
                            pass
                else:
                    # Inspeciona texto se o nome for ambíguo (contrato, declaração, etc)
                    if any(w in iname.upper() for w in ['CONTRATO', 'DECLARA', 'VIA', '40', '04']):
                        pdf_text = download_and_inspect_pdf(iid, access_token)

                code = classify_doc(iname, pdf_text, remap)
                if not code and code_from_content:
                    code = code_from_content

                if not code:
                    continue

                parsed_date = parse_date_from_filename(iname)
                if exp_from_content:
                    exp_date = exp_from_content
                else:
                    exp_date = calculate_expiration(code, parsed_date, REF_DATE)

                status, detail = evaluate_date(exp_date, REF_DATE)
                issue_date = parsed_date if parsed_date and parsed_date < REF_DATE else None

                cert_obj = {
                    'code': code,
                    'name': f'Doc {code}',
                    'filename': iname,
                    'issueDate': issue_date.strftime('%Y-%m-%dT03:00:00.000Z') if issue_date else None,
                    'expirationDate': exp_date.strftime('%Y-%m-%dT03:00:00.000Z') if exp_date else None,
                    'statusEHS': status,
                    'statusDetail': detail,
                    'sourcePath': f'https://drive.google.com/file/d/{iid}/view'
                }

                existing = certificates.get(code)
                if not existing:
                    certificates[code] = cert_obj
                else:
                    if exp_date:
                        exist_exp = existing.get('expirationDate')
                        if not exist_exp or exp_date.isoformat() > exist_exp:
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
                    conforme_count = sum(1 for c in res['certificates'].values() if c['statusEHS'] == 'CONFORME')
                    print(f'   + [{len(res["certificates"])} docs | {conforme_count} OK] {res["name"]}')
                except Exception as e:
                    print(f'   ! Erro ao escanear {fname}: {e}')

    print(f'\n>>> Total de colaboradores escaneados: {len(all_inspectors)}')
    total_conforme = sum(sum(1 for c in i['certificates'].values() if c['statusEHS'] == 'CONFORME') for i in all_inspectors)
    total_vencido = sum(sum(1 for c in i['certificates'].values() if c['statusEHS'] == 'VENCIDO') for i in all_inspectors)
    print(f'>>> Resumo Geral: CONFORME={total_conforme} | VENCIDO={total_vencido}')

    for out_path in [OUTPUT_DATA, OUTPUT_SCRATCH]:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(all_inspectors, f, indent=2, ensure_ascii=False)
        print(f'Salvo em: {out_path}')

if __name__ == '__main__':
    main()
