import json, pathlib, zlib, base64, shutil
p=pathlib.Path('data'); u=p/'update-2026-09-24'; backup=u/'backup'; backup.mkdir(exist_ok=True)
raw=json.loads(zlib.decompress(base64.b64decode(''.join(f.read_text().strip() for f in sorted(u.glob('part-*.b64'))))))
def read(name): return json.loads((p/name).read_text(encoding='utf-8'))
def save(name,obj):
    if not (backup/name).exists(): shutil.copy2(p/name,backup/name)
    (p/name).write_text(json.dumps(obj,ensure_ascii=False),encoding='utf-8')
old=read('ga4-google.json')
for k in ['ga4Products','ga4Orders']:
    assert raw[k]['rowCount']==len(raw[k]['rows'])
    old[k]['rows']=[r for r in old[k]['rows'] if r['dimensionValues'][0]['value']<'20260918']+raw[k]['rows']
    old[k]['rowCount']=len(old[k]['rows'])
old['googleCampaigns']['results']=[r for r in old['googleCampaigns']['results'] if r['segments']['date']<'2026-09-18']+raw['googleCampaigns']['results']
save('ga4-google.json',old)
gp=read('google-products.json'); gp['rows']=[r for r in gp['rows'] if r[0]<'2026-09-18']; idx={tuple(v):i for i,v in enumerate(gp['dictionary'])}
for date,id,title,kind,cost in raw['googleProducts']:
    key=(id,title,kind)
    if key not in idx: idx[key]=len(gp['dictionary']); gp['dictionary'].append(list(key))
    gp['rows'].append([date,idx[key],int(cost)])
save('google-products.json',gp)
for a in ['222947167250427','844151987085048']:
    for kind,name in [('account','meta-'+a+'.json'),('ad','meta-ads-'+a+'.json'),('products',('meta-allproducts-complete-' if a=='222947167250427' else 'meta-allproducts-')+a+'.json')]:
        new=json.loads((u/(a+'-'+kind+'.json')).read_text(encoding='utf-8')); assert not new.get('pagination',{}).get('next_cursor')
        obj=read(name); target=obj['account'] if kind=='account' else obj
        rows=[r for r in json.loads(target['ad_entities']) if r['date_start']<'2026-09-18']+json.loads(new['ad_entities'])
        target['ad_entities']=json.dumps(rows,ensure_ascii=False)
        save(name,obj)
(u/'google-ga4.json').write_text(json.dumps(raw,ensure_ascii=False),encoding='utf-8')
print('Merged through 2026-09-23; previous raw files backed up.')
