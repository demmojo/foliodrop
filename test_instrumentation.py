import json

def append_log(location, msg, data, hypothesis_id):
    payload = {
        "sessionId": "21d841",
        "location": location,
        "message": msg,
        "data": data,
        "timestamp": 123456789,
        "hypothesisId": hypothesis_id
    }
    with open("/home/demmojo/real-estate-hdr/.cursor/debug-21d841.log", "a") as f:
        f.write(json.dumps(payload) + "\n")
