import { describe, expect, it } from "vitest";
import { IlinkResponseError } from "../errors";
import { parseIlinkJson } from "../json";

describe("parseIlinkJson", () => {
  it("keeps ids above 2^53 exact", () => {
    const parsed = parseIlinkJson(
      '{"message_id":18446744073709551615,"msg_id": 9007199254740993,"svr_id":\n7493029384756102938}',
    );
    expect(parsed).toEqual({
      message_id: "18446744073709551615",
      msg_id: "9007199254740993",
      svr_id: "7493029384756102938",
    });
  });

  it("turns small and negative ids into strings too", () => {
    expect(parseIlinkJson('{"message_id":7,"msg_id":-12}')).toEqual({
      message_id: "7",
      msg_id: "-12",
    });
  });

  it("leaves ids that are already strings, and other numbers, alone", () => {
    expect(
      parseIlinkJson(
        '{"message_id":"42","seq":9007199254740993,"create_time_ms":1731400000000,"ret":-14}',
      ),
    ).toEqual({
      message_id: "42",
      seq: 9007199254740992,
      create_time_ms: 1731400000000,
      ret: -14,
    });
  });

  it("does not touch text that only looks like an id property", () => {
    const text = 'say "message_id": 18446744073709551615 and \\"msg_id\\":1';
    const parsed = parseIlinkJson(
      JSON.stringify({ text, title: '"svr_id":2', message_id_note: 3 }),
    );
    expect(parsed).toEqual({ text, title: '"svr_id":2', message_id_note: 3 });
  });

  it("does not treat an id name used as a value as a property", () => {
    expect(parseIlinkJson('{"keys":["message_id",1],"a":"msg_id"}')).toEqual({
      keys: ["message_id", 1],
      a: "msg_id",
    });
  });

  it("finds ids in nested objects and arrays", () => {
    const parsed = parseIlinkJson(`{
      "ret": 0,
      "msgs": [
        {
          "message_id": 12345678901234567890,
          "item_list": [
            {
              "type": 1,
              "msg_id": 12345678901234567891,
              "text_item": { "text": "hi" },
              "ref_msg": {
                "svr_id": 12345678901234567892,
                "message_item": { "msg_id": 12345678901234567893 }
              }
            }
          ]
        }
      ]
    }`);
    expect(parsed).toEqual({
      ret: 0,
      msgs: [
        {
          message_id: "12345678901234567890",
          item_list: [
            {
              type: 1,
              msg_id: "12345678901234567891",
              text_item: { text: "hi" },
              ref_msg: {
                svr_id: "12345678901234567892",
                message_item: { msg_id: "12345678901234567893" },
              },
            },
          ],
        },
      ],
    });
  });

  it("leaves a null, a fraction or an exponent to JSON.parse", () => {
    expect(
      parseIlinkJson('{"message_id":null,"msg_id":1.5,"svr_id":1e3}'),
    ).toEqual({ message_id: null, msg_id: 1.5, svr_id: 1000 });
  });

  it("refuses text that is not JSON without quoting it", () => {
    const text = '{"bot_token":"secret-token-value","message_id":';
    let thrown: unknown;
    try {
      parseIlinkJson(text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IlinkResponseError);
    expect((thrown as Error).message).not.toContain("secret");
    expect(() => parseIlinkJson("")).toThrow(IlinkResponseError);
    expect(() => parseIlinkJson("<html>502</html>")).toThrow(
      IlinkResponseError,
    );
  });
});
