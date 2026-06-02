import { I } from "../components/icons";
import { openUrl } from "../ipc";

const DOC_URL =
  "https://doc.payneteasy.com/integration/general_api_usage/request_authentication_methods/oauth.html";

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <h1>
          Generate a <em>secure key pair</em> for the Payneteasy API.
        </h1>
        <p>
          No terminal, no{" "}
          <code
            style={{
              fontFamily: "Geist Mono, monospace",
              fontSize: "14px",
              background: "var(--bg-sunken)",
              padding: "1px 6px",
              borderRadius: 4,
            }}
          >
            openssl
          </code>{" "}
          install — this app produces the same RSA-4096 keys the documentation describes, in three clicks.
        </p>
        <ul className="welcome-points">
          <li>
            <span className="check">{I.check}</span>
            <div>
              <strong>RSA 4096 by default</strong>
              <span>Matches the recommended settings from doc.payneteasy.com.</span>
            </div>
          </li>
          <li>
            <span className="check">{I.check}</span>
            <div>
              <strong>Local-only generation</strong>
              <span>Your private key never leaves this computer. Nothing is uploaded.</span>
            </div>
          </li>
          <li>
            <span className="check">{I.check}</span>
            <div>
              <strong>Send public key to support</strong>
              <span>
                Save the{" "}
                <code
                  style={{
                    fontFamily: "Geist Mono, monospace",
                    fontSize: 12,
                    background: "var(--bg-sunken)",
                    padding: "1px 5px",
                    borderRadius: 3,
                  }}
                >
                  public_key.pem
                </code>{" "}
                and forward it to your account manager.
              </span>
            </div>
          </li>
        </ul>
        <div className="row">
          <button className="btn btn-primary btn-large" onClick={onNext}>
            Get started {I.arrowRight}
          </button>
          <button className="btn btn-ghost" onClick={() => openUrl(DOC_URL)}>
            Read documentation
          </button>
        </div>
      </div>

      <div className="welcome-visual">
        <div className="key-illustration">
          <div className="key-card private">
            <div className="key-ico">{I.lockClosed}</div>
            <div className="key-meta">
              <div className="title">Private key</div>
              <div className="sub">private_key_pkcs_8.pem</div>
            </div>
            <div className="key-tag">Keep secret</div>
          </div>
          <div className="key-card public">
            <div className="key-ico">{I.globe}</div>
            <div className="key-meta">
              <div className="title">Public key</div>
              <div className="sub">public_key.pem</div>
            </div>
            <div className="key-tag">Share</div>
          </div>
          <div className="cmd-strike">
            <div className="line">
              <span className="strike">openssl genpkey -algorithm RSA -out … -pkeyopt rsa_keygen_bits:4096</span>
            </div>
            <div className="line">
              <span className="strike">openssl rsa -pubout -in … -out public_key.pem</span>
            </div>
            <div className="replaces">{I.sparkles} Replaced by this app</div>
          </div>
        </div>
      </div>
    </div>
  );
}
