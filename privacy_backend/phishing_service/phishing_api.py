from fastapi import FastAPI
from pydantic import BaseModel
from transformers import pipeline

# Load phishing model
classifier = pipeline("text-classification", model="ealvaradob/bert-finetuned-phishing")

# FastAPI app
app = FastAPI()

# Request schema
class UrlRequest(BaseModel):
    url: str

@app.post("/phishing")
def classify_phishing(request: UrlRequest):
    result = classifier(request.url)
    return {"url": request.url, "result": result}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("phishing_api:app", host="127.0.0.1", port=8000, reload=True)

