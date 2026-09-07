import os
import unittest
from unittest.mock import patch

from core.config import load_settings


class InworldSettingsTest(unittest.TestCase):
    def test_canonical_key_and_voice_power_creative_tts(self) -> None:
        with patch.dict(os.environ, {
            "INWORLD_API_KEY": "canonical-key",
            "INWORLD_VOICE_ID": "Dennis",
            "SQUAD_INWORLD_TTS_API_KEY": "legacy-key",
            "SQUAD_INWORLD_TTS_VOICE_ID": "Ashley",
        }, clear=True):
            settings = load_settings()

        self.assertEqual(settings.inworld_tts_api_key, "canonical-key")
        self.assertEqual(settings.inworld_tts_voice_id, "Dennis")

    def test_legacy_inworld_aliases_remain_compatible(self) -> None:
        with patch.dict(os.environ, {
            "INWORLD_RUNTIME_KEY": "runtime-key",
            "SQUAD_INWORLD_TTS_VOICE_ID": "Ashley",
        }, clear=True):
            settings = load_settings()

        self.assertEqual(settings.inworld_tts_api_key, "runtime-key")
        self.assertEqual(settings.inworld_tts_voice_id, "Ashley")


if __name__ == "__main__":
    unittest.main()
