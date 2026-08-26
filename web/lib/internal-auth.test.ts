import { afterEach, describe, expect, it } from "vitest";

import { INTERNAL_TOKEN_HEADER, isInternalRequest } from "./internal-auth";

function request(token?: string): Request {
  return new Request("http://localhost/api/internal/match/run", {
    method: "POST",
    headers: token === undefined ? {} : { [INTERNAL_TOKEN_HEADER]: token },
  });
}

const original = process.env.LIXTO_INTERNAL_TOKEN;

afterEach(() => {
  if (original === undefined) delete process.env.LIXTO_INTERNAL_TOKEN;
  else process.env.LIXTO_INTERNAL_TOKEN = original;
});

describe("isInternalRequest", () => {
  it("is false when the env var is unset — closed, not open", () => {
    delete process.env.LIXTO_INTERNAL_TOKEN;
    expect(isInternalRequest(request("anything"))).toBe(false);
  });

  it("is false when the env var is empty", () => {
    process.env.LIXTO_INTERNAL_TOKEN = "";
    expect(isInternalRequest(request(""))).toBe(false);
  });

  it("is false without the header", () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    expect(isInternalRequest(request())).toBe(false);
  });

  it("is false for a wrong token, of any length", () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    expect(isInternalRequest(request("s3cres"))).toBe(false);
    expect(isInternalRequest(request("s3cret-longer"))).toBe(false);
    expect(isInternalRequest(request("s3c"))).toBe(false);
  });

  it("is true for the exact token", () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    expect(isInternalRequest(request("s3cret"))).toBe(true);
  });
});
