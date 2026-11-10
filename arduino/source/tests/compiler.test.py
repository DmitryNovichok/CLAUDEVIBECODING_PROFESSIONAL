import importlib.util,threading,json,urllib.request,urllib.error,os
spec=importlib.util.spec_from_file_location('server','local/server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
server=m.ThreadingHTTPServer(('127.0.0.1',8765),m.Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def post(data,origin='http://127.0.0.1:8765'):
    request=urllib.request.Request('http://127.0.0.1:8765/api/compile',data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':origin})
    try:
        with opener.open(request,timeout=125) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
try:
    status,result=post({'board':'wokwi-arduino-uno','code':'void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);delay(20);digitalWrite(13,LOW);delay(20);}'})
    assert status==200,result
    assert result['hex'].startswith(':')
    status,result=post({'board':'wokwi-esp32-devkit-v1','code':'x'})
    assert status==400
    status,result=post({'board':'wokwi-arduino-uno','code':'x'},'https://example.com')
    assert status==403
    print('PASS: real Arduino CLI compilation through HTTP, unsupported board rejection, cross-origin request rejection')
finally:server.shutdown();server.server_close()
