import ssl
from urllib.error import HTTPError
from urllib.request import urlopen


def check_services():
    for url in ("https://127.0.0.1:6901/", "http://127.0.0.1:5555/health"):
        try:
            with urlopen(url, timeout=3, context=ssl._create_unverified_context()):
                raise RuntimeError("Authentication is not enforced")
        except HTTPError as exc:
            if exc.code != 401:
                raise


if __name__ == "__main__":
    check_services()
