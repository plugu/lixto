import pytest

from lixto.scrape import comprasnet as cn


def test_parse_compra_id_accepts_bare_id_and_url():
    assert cn.parse_compra_id("98233305900382026") == "98233305900382026"
    url = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=98233305900382026"
    assert cn.parse_compra_id(url) == "98233305900382026"
    assert cn.parse_compra_id(" compra 77130005900562025 ") == "77130005900562025"


def test_parse_compra_id_rejects_garbage():
    with pytest.raises(cn.ComprasnetScrapeError):
        cn.parse_compra_id("90038/2026")


def test_build_compra_id_pads_fields():
    assert cn.build_compra_id("982333", "90038", 2026) == "98233305900382026"
    assert cn.build_compra_id(929764, 7, 2026) == "92976405000072026"
    with pytest.raises(cn.ComprasnetScrapeError):
        cn.build_compra_id("1234567", 1, 2026)


def test_endpoint_slug_drops_query_and_token():
    url = (
        "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-disputa/v1/compras/"
        "98233305900382026/itens/3/lances?captcha=SECRET&pagina=2"
    )
    slug = cn.endpoint_slug(url)
    assert slug == "disputa_v1_compras_98233305900382026_itens_3_lances"
    assert "SECRET" not in slug


def test_extract_captcha_token():
    assert cn.extract_captcha_token("https://x/y?captcha=abc&pagina=1") == "abc"
    assert cn.extract_captcha_token("https://x/y?captcha=") is None
    assert cn.extract_captcha_token("https://x/y") is None


def test_is_api_url_only_matches_backend_services():
    assert cn.is_api_url(cn.FASE_EXTERNA + "/public/v1/compras/1")
    assert cn.is_api_url(cn.DISPUTA + "/v1/enums")
    assert not cn.is_api_url(cn.PUBLIC_PAGE + "?compra=1")
    assert not cn.is_api_url("https://api.hcaptcha.com/getcaptcha/x")


def test_as_list_handles_bare_list_and_envelopes():
    assert cn.as_list([1, 2]) == [1, 2]
    assert cn.as_list({"content": [1]}) == [1]
    assert cn.as_list({"data": [1], "total": 1}) == [1]
    assert cn.as_list({"foo": "bar"}) == []
    assert cn.as_list(None) == []


def test_item_number_variants():
    assert cn.item_number({"numero": 3}) == 3
    assert cn.item_number({"numeroItem": "12"}) == 12
    assert cn.item_number({"descricao": "x"}) is None
    assert cn.item_number("not a dict") is None


def test_raw_store_never_overwrites(tmp_path):
    store = cn._RawStore(tmp_path / "raw")
    url = cn.DISPUTA + "/v1/compras/1/itens/1/lances?captcha=T&pagina=1"
    a = store.save(url, {"p": 1})
    b = store.save(url, {"p": 2})
    assert a == "disputa_v1_compras_1_itens_1_lances.json"
    assert b == "disputa_v1_compras_1_itens_1_lances.1.json"
    assert len(store.files) == 2
    assert all((tmp_path / f).exists() for f in store.files)


def test_unknown_engine_is_rejected(tmp_path):
    import asyncio

    with pytest.raises(cn.ComprasnetScrapeError, match="unknown engine"):
        asyncio.run(cn.scrape_async("98233305900382026", tmp_path, engine="edge"))


def test_default_engine_is_camoufox():
    assert cn.DEFAULT_ENGINE == "camoufox"
    assert set(cn.ENGINES) == {"camoufox", "chromium"}
