import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/whatsapp", tags=["whatsapp"])


class WhatsAppTestMessage(BaseModel):
    to: str
    message: str = "RTOGuardAI WhatsApp integration test successful!"


@router.post("/send-test")
async def send_test_message(data: WhatsAppTestMessage):
    token = os.getenv("WHATSAPP_ACCESS_TOKEN")
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    api_version = os.getenv("WHATSAPP_API_VERSION", "v23.0")

    if not token or not phone_number_id:
        raise HTTPException(
            status_code=503,
            detail="WhatsApp Cloud API credentials are not configured",
        )

    recipient = "".join(c for c in data.to if c.isdigit())
    if len(recipient) < 8 or len(recipient) > 15:
        raise HTTPException(
            status_code=400,
            detail="Enter recipient number with country code",
        )

    if not data.message.strip() or len(data.message) > 1000:
        raise HTTPException(
            status_code=400,
            detail="Message must contain 1â€“1000 characters",
        )

    url = (
        f"https://graph.facebook.com/{api_version}/"
        f"{phone_number_id}/messages"
    )
    payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "text",
        "text": {"body": data.message},
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Could not reach WhatsApp API",
        )

    if response.is_error:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "WhatsApp rejected the message",
                "status": response.status_code,
                "error": response.json().get("error", {}).get("message", "API error"),
            },
        )

    result = response.json()
    return {
        "status": "sent_to_whatsapp_api",
        "message_id": result.get("messages", [{}])[0].get("id"),
    }
