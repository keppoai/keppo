import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { LegalPage } from "@/components/legal/legal-page";

export const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy | Keppo" },
      { name: "description", content: "Privacy Policy for Keppo by Dyad Tech, Inc." },
    ],
  }),
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="March 30, 2026">
      <h2>What Keppo Collects</h2>

      <h3>Account Information</h3>
      <p>
        When you sign up for Keppo, we collect the information you provide during registration, such
        as your name and email address. If you sign in through a third-party provider (e.g., GitHub
        or Google), we receive basic profile information from that provider.
      </p>

      <h3>Automation and Integration Data</h3>
      <p>
        To run your automations, Keppo stores your automation configurations, rules, and the
        credentials you provide for connected integrations (e.g., Slack, Stripe, GitHub, Gmail). We
        also store execution logs for each automation run, including inputs, outputs, tool calls,
        and approval decisions. This data is necessary to operate the Service, provide audit trails,
        and help you debug your automations.
      </p>
      <p>
        <strong>Your data is never used to train any AI model.</strong>
      </p>

      <h3>Usage and Analytics Data</h3>
      <p>
        We collect analytics data to understand how the Service is used and to improve it. This
        includes feature usage events, page views, performance metrics, and error reports. This data
        is associated with your account and is collected automatically when you use the Service.
      </p>

      <h3>Payment Information</h3>
      <p>
        If you subscribe to a paid plan, payment processing is handled by Stripe. We do not store
        your full credit card number. Stripe's handling of your payment information is governed by
        their{" "}
        <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        .
      </p>

      <h2>How We Use Your Data</h2>

      <ul>
        <li>
          <strong>Operating the Service:</strong> Running your automations, processing approvals,
          enforcing rules, and connecting to your integrations.
        </li>
        <li>
          <strong>Audit logging:</strong> Maintaining an audit trail of automation runs, approvals,
          and configuration changes for your review.
        </li>
        <li>
          <strong>Service improvement:</strong> We may use aggregated and anonymized usage data to
          improve the product and service quality. We do not use your automation content or
          integration data for this purpose.
        </li>
        <li>
          <strong>Support and troubleshooting:</strong> When you contact us for help, we may access
          your account data to diagnose and resolve your issue.
        </li>
        <li>
          <strong>Security and abuse prevention:</strong> Monitoring for abuse, fraud, and security
          threats to protect the Service and its users.
        </li>
      </ul>

      <h2>How Your Data Flows</h2>

      <h3>Hosted Service (keppo.ai)</h3>
      <p>
        When you use the hosted Keppo service, your automation configurations, integration
        credentials, and execution data are stored on our infrastructure. When automations run,
        Keppo connects to your integrated services on your behalf using the credentials you provide.
      </p>
      <p>
        AI-powered features (such as rule authoring and automation generation) route prompts through
        our servers to the relevant AI model providers. These providers process your prompts
        according to their own data processing agreements and do not use your data for model
        training.
      </p>

      <h3>Self-Hosted Instances</h3>
      <p>
        If you self-host Keppo under the open-source license, your data remains entirely on your own
        infrastructure. This Privacy Policy does not apply to self-hosted instances.
      </p>

      <h2>Data Retention</h2>

      <p>
        We retain your data for as long as your account is active or as needed to provide the
        Services. Execution logs are retained according to your plan's log retention period (7 days
        for free accounts, 30 days for Starter, and 90 days for Pro). If you cancel your account, we
        will delete your data within 30 days, except where we are required to retain it by law.
      </p>

      <h2>Your Data Rights</h2>

      <p>You have the right to:</p>

      <ul>
        <li>
          <strong>Access</strong> your personal information and request a copy of the data we hold
          about you.
        </li>
        <li>
          <strong>Correct</strong> inaccurate or incomplete personal information.
        </li>
        <li>
          <strong>Delete</strong> your account and associated data ("right to be forgotten").
        </li>
        <li>
          <strong>Export</strong> your data in a portable format.
        </li>
        <li>
          <strong>Object</strong> to or restrict certain types of data processing.
        </li>
      </ul>

      <p>
        To exercise any of these rights, contact us at{" "}
        <a href="mailto:support@keppo.ai">support@keppo.ai</a>.
      </p>

      <h2>Third-Party Services</h2>

      <p>
        We use third-party services to operate Keppo. These include cloud hosting providers, payment
        processors, analytics services, and AI model providers. Each processes data only as
        necessary to provide their service to us and is bound by their own privacy policies and our
        data processing agreements.
      </p>

      <h2>Data Location</h2>

      <p>
        All data infrastructure for the hosted Keppo service is located in the United States. If you
        are accessing the Service from outside the United States, you consent to the transfer of
        your data to the U.S. for processing and storage.
      </p>

      <h2>Government Requests</h2>

      <p>
        We comply with legally compelled requests for data, such as warrants, subpoenas, and court
        orders. When legally permitted, we will notify you before disclosing your information in
        response to such requests.
      </p>

      <h2>CCPA Compliance</h2>

      <p>
        Under the California Consumer Privacy Act, Keppo functions as a "service provider." We
        process personal information only for the purposes described in this policy and do not sell
        your personal information.
      </p>

      <h2>Changes to This Policy</h2>

      <p>
        We may update this Privacy Policy from time to time. When we make significant changes, we
        will update the date at the top of this page and notify you via email or through the
        Service.
      </p>

      <p>
        Questions or concerns? Contact us at <a href="mailto:support@keppo.ai">support@keppo.ai</a>.
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

export { PrivacyPage };
