import pytest

from pro_meta_intelligence.ingestion.http import HttpTransportError, UrllibTransport


def test_http_transport_rejects_non_https_and_unregistered_hosts_before_network() -> None:
    transport = UrllibTransport(allowed_hosts=frozenset({"ddragon.leagueoflegends.com"}))

    with pytest.raises(HttpTransportError, match="allowlisted HTTPS"):
        transport.fetch(
            "http://ddragon.leagueoflegends.com/api/versions.json",
            maximum_bytes=1024,
            user_agent="test",
        )
    with pytest.raises(HttpTransportError, match="allowlisted HTTPS"):
        transport.fetch(
            "https://example.com/api/versions.json",
            maximum_bytes=1024,
            user_agent="test",
        )
