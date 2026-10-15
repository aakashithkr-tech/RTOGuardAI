"""Optional BHASHINI Multilingual Indian Language Translation Service.

Provides Indian language translation (e.g., Hindi, Tamil, Telugu, Marathi, Bengali)
for customer NDR alerts, WhatsApp follow-ups, and plain-language risk explanations.

Operates as a strictly optional enhancement:
- If BHASHINI credentials are not provided, uses deterministic localized templates.
- Core prediction, persistence, and intelligence engines do NOT depend on BHASHINI.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger("rtoguard.bhashini")

BHASHINI_API_KEY = os.environ.get("BHASHINI_API_KEY")
BHASHINI_USER_ID = os.environ.get("BHASHINI_USER_ID")
BHASHINI_PIPELINE_ID = os.environ.get("BHASHINI_PIPELINE_ID")

# Supported common Indian language targets
SUPPORTED_LANGUAGES = {
    "hi": "Hindi",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "bn": "Bengali",
    "kn": "Kannada",
    "gu": "Gujarati",
}

# Offline localized template dictionary for reliable fallback
FALLBACK_TEMPLATES = {
    "hi": {
        "address_verification": (
            "नमस्ते! आपका ऑर्डर तैयार है। कृपया अपने पते और लैंडमार्क की पुष्टि करें "
            "ताकि डिलीवरी बिना किसी देरी के समय पर हो सके।"
        ),
        "prepaid_incentive": (
            "नमस्ते! तुरंत ऑनलाइन (UPI) भुगतान करें और अपने ऑर्डर पर अतिरिक्त ₹50 की छूट पाएं। "
            "कैश-ऑन-डिलीवरी से बचने के लिए यहाँ क्लिक करें।"
        ),
        "ndr_reschedule": (
            "नमस्ते! आपका पार्सल आज डिलीवर नहीं हो सका। कृपया अपनी सुविधानुसार डिलीवरी का "
            "नया समय या पता चुनें।"
        ),
    },
    "mr": {
        "address_verification": (
            "नमस्कार! तुमची ऑर्डर तयार आहे. वेळेवर डिलिव्हरीसाठी कृपया तुमच्या पत्त्याची "
            "आणि लँडमार्कची खात्री करा."
        ),
    },
}


def bhashini_configured() -> bool:
    """Return whether valid Bhashini API credentials are present."""
    return bool(BHASHINI_API_KEY and BHASHINI_USER_ID)


async def translate_text(
    text: str,
    target_language: str = "hi",
    template_type: Optional[str] = None,
) -> dict[str, Any]:
    """Translate message to target Indian language via Bhashini API, with fallback.

    Gracefully falls back to localized templates if service is unavailable or unconfigured.
    """
    target = target_language.lower()
    if not bhashini_configured():
        fallback_msg = (
            FALLBACK_TEMPLATES.get(target, {}).get(template_type or "")
            or f"[{SUPPORTED_LANGUAGES.get(target, target)}]: {text}"
        )
        return {
            "source_text": text,
            "translated_text": fallback_msg,
            "target_language": target,
            "service": "fallback_local_template",
            "bhashini_active": False,
        }

    # Bhashini ULCA Translation Pipeline
    url = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline"
    headers = {
        "Authorization": BHASHINI_API_KEY,
        "userID": BHASHINI_USER_ID,
        "Content-Type": "application/json",
    }
    payload = {
        "pipelineTasks": [
            {
                "taskType": "translation",
                "config": {
                    "language": {
                        "sourceLanguage": "en",
                        "targetLanguage": target,
                    }
                },
            }
        ],
        "inputData": {
            "input": [{"source": text}]
        },
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                trans_text = data["pipelineResponse"][0]["output"][0]["target"]
                return {
                    "source_text": text,
                    "translated_text": trans_text,
                    "target_language": target,
                    "service": "bhashini_cloud_api",
                    "bhashini_active": True,
                }
            logger.warning(f"Bhashini API returned status {resp.status_code}: {resp.text}")
    except Exception as exc:
        logger.warning(f"Bhashini request failed: {exc}")

    fallback_msg = (
        FALLBACK_TEMPLATES.get(target, {}).get(template_type or "")
        or f"[{SUPPORTED_LANGUAGES.get(target, target)}]: {text}"
    )
    return {
        "source_text": text,
        "translated_text": fallback_msg,
        "target_language": target,
        "service": "fallback_local_template",
        "bhashini_active": False,
    }
