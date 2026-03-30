import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { LegalPage } from "@/components/legal/legal-page";

export const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/terms",
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms of Service | Keppo" },
      { name: "description", content: "Terms of Service for Keppo by Dyad Tech, Inc." },
    ],
  }),
});

function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="March 30, 2026">
      <p>
        From everyone at Dyad Tech, Inc. ("<strong>Company</strong>"), thank you for using Keppo.
        When we say "<strong>Services</strong>," we mean the Keppo hosted platform available at
        keppo.ai, including any associated APIs, and any related services provided by the Company.
        When we say "<strong>You</strong>" or "<strong>your</strong>," we mean you, the individual
        or entity agreeing to these Terms. These Terms do not apply to self-hosted instances of
        Keppo running under the applicable open-source license.
      </p>

      <p>
        We may update these Terms in the future. Whenever we make a significant change, we will
        refresh the date at the top of this page. When you use our Services, now or in the future,
        you are agreeing to the latest Terms. If you do not agree to them, you should not use the
        Services. There may be times where we do not exercise or enforce a right or provision of the
        Terms; in doing so, we are not waiving that right or provision. These Terms do contain a
        limitation of liability.
      </p>

      <p>
        If you violate any of the Terms, we may terminate your account. That is a broad statement
        and it means you need to place a lot of trust in us. We do our best to deserve that trust by
        being open about our policies and keeping an open door to your feedback.
      </p>

      <h2>Account Terms</h2>

      <ol>
        <li>
          You are responsible for maintaining the security of your account and password. The Company
          cannot and will not be liable for any loss or damage from your failure to comply with this
          security obligation.
        </li>
        <li>
          You may not use the Services for any purpose outlined in our{" "}
          <a href="#abuse-policy">Abuse Policy</a>.
        </li>
        <li>
          You are responsible for all content posted to and activity that occurs under your account,
          including content posted by and activity of any automations configured in your account.
        </li>
        <li>
          You must be a human. Accounts registered by bots or automated methods are not permitted.
        </li>
      </ol>

      <h2>Payment, Refunds, and Plan Changes</h2>

      <ol>
        <li>
          The Services offer a free tier that does not require a credit card. We do not sell your
          data. If you are on a free plan, your data is treated with the same respect as any paying
          customer's data.
        </li>
        <li>
          For paid plans (Starter and Pro), billing occurs monthly. If you do not pay for your
          subscription, your account will be downgraded to the free tier and features exclusive to
          paid plans will become unavailable.
        </li>
        <li>
          All fees are exclusive of all taxes, levies, or duties imposed by taxing authorities.
          Where required, we will collect those taxes on behalf of the relevant tax authority.
          Otherwise, you are responsible for payment of all applicable taxes.
        </li>
        <li>
          Refund requests should be directed to{" "}
          <a href="mailto:support@keppo.ai">support@keppo.ai</a>. We handle them on a case-by-case
          basis.
        </li>
      </ol>

      <h2>Cancellation and Termination</h2>

      <ol>
        <li>
          You are solely responsible for properly canceling your account. You can cancel your
          subscription at any time through the billing section of the Service. If you need help, you
          can reach us at <a href="mailto:support@keppo.ai">support@keppo.ai</a>, but email alone is
          not considered cancellation.
        </li>
        <li>
          If you cancel before the end of your current billing period, your cancellation will take
          effect at the end of that period. You will not be charged again, but no partial refunds
          are provided for unused time in the current period.
        </li>
        <li>
          The Company, in its sole discretion, has the right to suspend or terminate your account
          and refuse any and all current or future use of the Services for any reason at any time.
          Such termination may result in the deactivation or deletion of your account and all
          associated data, including your automation configurations and execution logs. The Company
          reserves the right to refuse service to anyone for any reason at any time.
        </li>
        <li>
          Verbal, physical, written, or other abuse (including threats of abuse or retribution) of
          any Company employee or officer will result in immediate account termination.
        </li>
      </ol>

      <h2>Modifications to the Service and Prices</h2>

      <p>
        We reserve the right to modify or discontinue, temporarily or permanently, any part of the
        Services with or without notice. When pricing changes affect existing customers, we will
        give at least 30 days' notice via the email address associated with your account or through
        an announcement on the Services.
      </p>

      <h2>Uptime, Security, and Privacy</h2>

      <ol>
        <li>
          The Services are provided on an "as is" and "as available" basis. We do not offer
          service-level agreements for any of our Services, but we do take uptime seriously.
        </li>
        <li>
          We reserve the right to temporarily disable your account if your usage significantly
          exceeds the average usage of other customers on the same plan. We will reach out to the
          account owner before taking any action except in rare cases where the level of use may
          negatively impact the performance of the Service for other customers.
        </li>
        <li>
          We take many measures to protect and secure your data through backups, redundancies, and
          encryption. When you use our Services, you entrust us with your data, including automation
          configurations, integration credentials, and execution logs. We treat that trust
          seriously. You agree that Keppo may process your data as described in our{" "}
          <a href="/privacy">Privacy Policy</a> and for no other purpose.
        </li>
        <li>
          Our employees access your data only when necessary for the reasons described in our
          Privacy Policy: responding to support requests (with your consent), investigating
          potential abuse, maintaining system reliability, or complying with legal requirements.
        </li>
        <li>
          We use third-party vendors and hosting partners to provide the necessary hardware,
          software, networking, storage, and related technology required to run the Services.
        </li>
      </ol>

      <h2>Copyright and Content Ownership</h2>

      <ol>
        <li>
          All right, title, and interest in and to the Services, including all intellectual property
          rights therein, are and will remain the exclusive property of the Company. You must
          request permission to use the Company's logos or any Service logos for promotional
          purposes. Please email <a href="mailto:support@keppo.ai">support@keppo.ai</a> for
          requests.
        </li>
        <li>
          You retain all rights to the data and content you provide to the Services, including your
          automation configurations and the outputs of your automations.
        </li>
        <li>
          You may not reproduce, duplicate, copy, sell, resell, or exploit any portion of the
          Services, use of the Services, or access to the Services without the express written
          permission of the Company.
        </li>
      </ol>

      <h2 id="abuse-policy">Abuse Policy</h2>

      <p>You may not use the Services to:</p>

      <ul>
        <li>Violate any applicable laws or regulations.</li>
        <li>
          Send unsolicited messages, spam, or bulk communications through connected integrations.
        </li>
        <li>
          Attempt to gain unauthorized access to other users' accounts, data, or connected services.
        </li>
        <li>
          Circumvent or attempt to circumvent usage limits, rate limits, or other technical
          restrictions of the Services.
        </li>
        <li>
          Use the Services to conduct denial-of-service attacks or other attacks against third-party
          services through connected integrations.
        </li>
        <li>
          Use the Services in any manner that could damage, disable, overburden, or impair any of
          our servers, or interfere with any other party's use of the Services.
        </li>
      </ul>

      <h2>Features and Bugs</h2>

      <p>
        We design our Services with care and aim to make them useful and reliable. That said, we
        cannot guarantee that the Services will meet your specific requirements. We also test all
        features extensively before shipping them, but bugs are an inevitable part of software. We
        track the bugs reported to us and work through them, with priority given to security and
        privacy issues. Not all reported bugs will be fixed, and we do not guarantee completely
        error-free Services.
      </p>

      <h2>Liability</h2>

      <p>
        We mention liability throughout these Terms but to put it all in one section: You expressly
        understand and agree that the Company shall not be liable, in law or in equity, to you or to
        any third party for any direct, indirect, incidental, lost profits, special, consequential,
        punitive, or exemplary damages, including but not limited to damages for loss of profits,
        goodwill, use, data, or other intangible losses (even if the Company has been advised of the
        possibility of such damages), resulting from: (i) the use or the inability to use the
        Services; (ii) the cost of procurement of substitute goods and services resulting from any
        goods, data, information, or services purchased or obtained or messages received or
        transactions entered into through or from the Services; (iii) unauthorized access to or
        alteration of your transmissions or data; (iv) statements or conduct of any third party on
        the Service; (v) or any other matter relating to these Terms or the Services, whether as a
        breach of contract, tort (including negligence whether active or passive), or any other
        theory of liability.
      </p>

      <p>
        In other words: choosing to use our Services does mean you are making a bet on us. If the
        bet does not work out, that's on you, not us. We do our darnedest to be as safe a bet as
        possible. If you have a question, contact{" "}
        <a href="mailto:support@keppo.ai">support@keppo.ai</a>.
      </p>

      <p className="text-sm text-muted-foreground mt-8">
        Adapted from the{" "}
        <a href="https://github.com/basecamp/policies" target="_blank" rel="noopener noreferrer">
          Basecamp open-source policies
        </a>{" "}
        / CC BY 4.0.
      </p>
    </LegalPage>
  );
}

export { TermsPage };
