import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from helper import tts, video
from helper.app import app

client = TestClient(app)


def test_wav_is_16_bit_mono_with_the_right_length():
    samples = np.sin(np.linspace(0, 100, 24000)).astype(np.float32)
    with wave.open(io.BytesIO(tts.to_wav(samples, 24000))) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 24000, 24000)


def test_each_voice_clip_lands_where_its_beat_started():
    rate = 1000
    clips = [(np.ones(100, np.float32), rate), None, (np.full(50, 0.5, np.float32), rate)]
    track, r = video.narration_track(clips, [10.5, 11.0, 12.0], t0=10.0, seconds=3)
    assert r == rate
    assert track[499] == 0 and track[500] == 1 and track[599] == 1 and track[600] == 0
    assert track[2000] == 0.5 and track[2049] == 0.5 and track[2050] == 0


def test_the_render_page_gets_the_lesson_but_not_the_speech_text():
    job = video.Job(id="0" * 16, lesson={"title": "T", "parts": [{"title": "P", "beats": [{"say": "Hi $x^2$", "speech": "Hi x squared", "draw": [], "point": None}]}]}, app_url="http://127.0.0.1:3100")
    job.durations = [[1200]]
    data = video.render_data(job)
    assert data["parts"][0]["beats"][0] == {"say": "Hi $x^2$", "draw": [], "point": None}
    assert data["durations"] == [[1200]]


def test_videos_are_only_recorded_from_this_computer():
    lesson = {"title": "T", "parts": [{"title": "P", "beats": [{"say": "Hi"}]}]}
    r = client.post("/video/start", json={"lesson": lesson, "appUrl": "http://example.com:3100"})
    assert r.status_code == 400
    assert client.get("/video/" + "f" * 16).status_code == 404


@pytest.mark.skipif(not tts.installed(), reason="the offline voice isn't downloaded")
def test_the_offline_voice_speaks():
    r = client.post("/tts", json={"text": "Hello, this is your teacher.", "language": "english"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert int(r.headers["x-duration-ms"]) > 500
