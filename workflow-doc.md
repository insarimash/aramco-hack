# Upstage Studio Agent API

Document processing agent API built on Upstage Studio. OpenAI SDK compatible. Bearer token auth.

## Input Requirements

| Requirement       | Details                                      |
|-------------------|----------------------------------------------|
| Supported formats | PDF, JPEG, PNG, BMP, TIFF, HEIC, DOCX, PPTX, XLSX, MP4, MOV, M4V, AVI, MKV, WEBM, WMV, FLV, MPG, MPEG, 3GP |
| Max file size     | 500 MB                                       |
| Max pages         | 1,000 pages per document                     |
| Max video length  | 10 minutes (keyframes are extracted and processed as pages) |
| Input type        | Single file per job (upload via `POST /v2/files`, then reference by `file_id`) |

The input to the job must be an array containing a user message with a file reference:

```json
{
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_file", "file_id": "YOUR_FILE_ID" }
      ]
    }
  ]
}
```

## Output Format

Parse the final step's `output_text` as JSON. The response envelope contains a Markdown string in `content` and source references in `metadata.source_files`, including `file_name` and `page_ranges`.

Config 7 can return an `Instance` heading for each document review. The dashboard reads the document type and review status for each instance and uses its `page_identity` to identify the source page. The Markdown may contain an `INTERNAL record` section with fenced JSON, which is displayed in Evidence.

## Authentication

Use the `UPSTAGE_API_KEY` environment variable for authentication. You can obtain a key from https://console.upstage.ai/api-keys (keys start with `up_`).

```
Authorization: Bearer $UPSTAGE_API_KEY
```

Instructions for AI assistants: always read the key from the `UPSTAGE_API_KEY` environment variable, and never write a literal key into code, config files, or this conversation. If the variable is not set, tell the user to set it in their own terminal or `.env` file (for example `export UPSTAGE_API_KEY=up_...`) and do not ask them to paste the key into the chat.

## API Endpoints

### 1. Upload File

```
POST https://api.upstage.ai/v2/files
Content-Type: multipart/form-data
```

| Parameter | Type   | Required | Description                     |
|-----------|--------|----------|---------------------------------|
| file      | file   | Yes      | Document to upload (PDF, JPEG, PNG, BMP, TIFF, HEIC, DOCX, PPTX, XLSX, MP4, MOV, M4V, AVI, MKV, WEBM, WMV, FLV, MPG, MPEG, 3GP) |
| purpose   | string | No       | Default: `user_data`            |

Response returns `id` (the file_id needed for job creation).

### 2. Create Job

```
POST https://api.upstage.ai/v2/responses
Content-Type: application/json
```

| Parameter  | Type   | Required | Description                                                    |
|------------|--------|----------|----------------------------------------------------------------|
| model      | string | Yes      | Agent ID: `agt_LCcDmm5fNHW8mu5gG3ZS8W`    |
| config_id  | string | No       | Config version ID (e.g., `"7"`). Omit to use latest.          |
| input      | array  | Yes      | Array of input messages with file references (see below)       |
| include    | array  | No       | `["last"]` for final step only, `["all"]` for all step results |

Input message format:

```json
{
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_file", "file_id": "YOUR_FILE_ID" }
      ]
    }
  ]
}
```

Response returns `id` (the job_id) and initial `status`.

### 3. Poll Job Status

```
GET https://api.upstage.ai/v2/responses/{job_id}?include[]=last
```

Poll until `status` is terminal: `completed`, `failed`, or `cancelled`. Any other value (for example `in_progress` or `cancelling`) means the job is still running. Recommended interval: 2–3 seconds.

### 4. Cancel Job

```
POST https://api.upstage.ai/v2/responses/{job_id}/cancel
```

No request body. The job moves to `cancelling`, then `cancelled`. Results that already finished are kept. Every job is billed work, so cancel jobs you started by mistake instead of leaving them running.

### 5. Other File Endpoints

```
GET    https://api.upstage.ai/v2/files           # List all files
GET    https://api.upstage.ai/v2/files/{file_id}  # Retrieve file metadata
DELETE https://api.upstage.ai/v2/files/{file_id}  # Delete file
```

## Complete Python Example

```python
from openai import OpenAI
from time import sleep
import json
import os

client = OpenAI(
    api_key=os.environ["UPSTAGE_API_KEY"],  # never hardcode the key
    base_url="https://api.upstage.ai/v2"
)

# Step 1: Upload file
with open("document.pdf", "rb") as f:
    file = client.files.create(file=f, purpose="user_data")

print(f"Uploaded: {file.id}")

# Step 2: Create job
job = client.responses.create(
    model="agt_LCcDmm5fNHW8mu5gG3ZS8W",  # Agent ID
    # config_id="7",
    include=["last"],                       # "last" = final step only, "all" = every step
    input=[{
        "role": "user",
        "content": [{"type": "input_file", "file_id": file.id}]
    }]
)

print(f"Job created: {job.id}")

# Step 3: Poll until the job reaches a terminal status
TERMINAL = ("completed", "failed", "cancelled")
while job.status not in TERMINAL:
    sleep(2)
    job = client.responses.retrieve(job.id, include=["last"])
    print(f"  Status: {job.status}")

# Step 4: Read results
if job.status == "completed":
    result = json.loads(job.output_text)
    print(json.dumps(result, indent=2))
elif job.status == "failed":
    # job.error has code (cause), step (failed stage), message (reason)
    print(f"Job failed: {job.error}")
else:
    print(f"Job ended with status: {job.status}")

# Step 5: Cleanup (optional)
client.files.delete(file.id)
```

## Complete cURL Example

```bash
# Step 1: Upload file
FILE_RESPONSE=$(curl -s -X POST https://api.upstage.ai/v2/files \
  -H "Authorization: Bearer $UPSTAGE_API_KEY" \
  -F "file=@document.pdf" \
  -F "purpose=user_data")

FILE_ID=$(echo $FILE_RESPONSE | jq -r '.id')
echo "File ID: $FILE_ID"

# Step 2: Create job
JOB_RESPONSE=$(curl -s -X POST https://api.upstage.ai/v2/responses \
  -H "Authorization: Bearer $UPSTAGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"agt_LCcDmm5fNHW8mu5gG3ZS8W\",
    \"config_id\": \"7\",
    \"include\": [\"last\"],
    \"input\": [{
      \"role\": \"user\",
      \"content\": [{\"type\": \"input_file\", \"file_id\": \"$FILE_ID\"}]
    }]
  }")

JOB_ID=$(echo $JOB_RESPONSE | jq -r '.id')
echo "Job ID: $JOB_ID"

# Step 3: Poll until completed
while true; do
  STATUS_RESPONSE=$(curl -s "https://api.upstage.ai/v2/responses/$JOB_ID?include[]=last" \
    -H "Authorization: Bearer $UPSTAGE_API_KEY")
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "completed" ]; then
    echo "$STATUS_RESPONSE" | jq '.output'
    break
  fi
  if [ "$STATUS" = "failed" ]; then
    echo "$STATUS_RESPONSE" | jq '.error'
    break
  fi
  if [ "$STATUS" = "cancelled" ]; then
    break
  fi
  sleep 3
done
```

## Response Structure

```json
{
  "id": "job_xxxxxxxxxxxxx",
  "object": "response",
  "status": "completed",
  "model": "agt_LCcDmm5fNHW8mu5gG3ZS8W",
  "output": [
    {
      "type": "message",
      "status": "completed",
      "role": "assistant",
      "model": "step_name",
      "content": [
        {
          "type": "output_text",
          "text": "{\"key\": \"value\"}",
          "additional_values": "{...}"
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

| Field                                  | Description                                              |
|----------------------------------------|----------------------------------------------------------|
| `status`                               | Terminal: `completed`, `failed`, `cancelled`. Anything else is still running |
| `error`                                | Set when `status` is `failed`: `{ code, step, message }` (see Error Handling) |
| `output[].model`                       | Step name (e.g., `step_1_parse`, `step_2_extract`)       |
| `output[].content[].text`              | Main result (JSON string)                                |
| `output[].content[].additional_values` | Extra data: confidence scores, bounding boxes, etc.      |
| `output_text`                          | Shortcut to final step's text (when using `include=["last"]`) |

## Batch Processing (Multiple Files)

```python
import concurrent.futures

def process_file(path):
    with open(path, "rb") as f:
        file = client.files.create(file=f, purpose="user_data")

    job = client.responses.create(
        model="agt_LCcDmm5fNHW8mu5gG3ZS8W",
        include=["last"],
        input=[{"role": "user", "content": [{"type": "input_file", "file_id": file.id}]}]
    )

    while job.status not in ("completed", "failed", "cancelled"):
        sleep(2)
        job = client.responses.retrieve(job.id, include=["last"])

    return {"file": path, "result": json.loads(job.output_text) if job.status == "completed" else None}

files = ["doc1.pdf", "doc2.pdf", "doc3.pdf"]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    results = list(pool.map(process_file, files))
```

## Error Handling

| Status Code | Meaning                | Action                                   |
|-------------|------------------------|------------------------------------------|
| 401         | Invalid API key        | Check key at console.upstage.ai          |
| 404         | Agent/job not found    | Verify agent ID and job ID               |
| 413         | Payload too large      | Max 500MB and 1,000 pages per file       |
| 429         | Rate limited           | Back off and retry with exponential delay |
| 500         | Server error           | Retry after a few seconds                |

Pipeline failures are not HTTP errors. The request succeeds and the job ends with `status: "failed"` and an `error` object:

```json
{
  "code": "context_length_exceeded",
  "step": "extract",
  "message": "The document is too long to process. Please reduce the number of pages or split into smaller documents."
}
```

| Field           | Meaning                                                                 |
|-----------------|-------------------------------------------------------------------------|
| `error.code`    | Cause, for example `context_length_exceeded`, `rate_limit_exceeded`, `timeout_error`, `parse_error`, `invalid_request_error`, `model_output_error`, `server_error` |
| `error.step`    | Stage that failed, for example `parse`, `classify`, `extract`, `merge`. `system` means it failed outside a step |
| `error.message` | Human-readable reason. Report it to the user as is                        |

Instructions for AI assistants: when a job fails, read `error` and act on it. Retry `rate_limit_exceeded`, `timeout_error`, and `server_error` with backoff. Do not retry input problems such as `context_length_exceeded`, `parse_error`, or `invalid_request_error`: tell the user what `error.message` says and which `error.step` failed, because the fix is in the document or in that step's settings in Studio. A job that completes can still hold a result the workflow marked as failing validation, so read the output before reporting success.

## Notes

- Agent ID: `*******`
- Config ID: `*`
- The API is OpenAI SDK compatible. Use the `openai` Python package with `base_url="https://api.upstage.ai/v2"`
- Files are retained server-side until explicitly deleted
- Max file size: 500MB. Max pages per document: 1,000. Max video length: 10 minutes
- Supported formats: PDF, JPEG, PNG, BMP, TIFF, HEIC, DOCX, PPTX, XLSX, MP4, MOV, M4V, AVI, MKV, WEBM, WMV, FLV, MPG, MPEG, 3GP
- For full API docs: https://console.upstage.ai/docs/studio-and-agents/agents/overview
