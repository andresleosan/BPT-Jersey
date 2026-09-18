import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseEnrolmentRequestSubmission } from "@bpt-jersey/domain/members/enrolment-requests";
import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";

const authState = vi.hoisted(() => ({
  status: "signed-in" as "signed-in" | "signed-out" | "loading",
  session: undefined as
    | {
        uid: string;
        email: string;
        displayName: string;
        role?: "guardian" | "adultStudent" | "shopper";
      }
    | undefined,
  signOut: vi.fn(),
}));

const enrolmentApi = vi.hoisted(() => ({
  createEnrolmentRequestId: vi.fn(() => "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11"),
  listMyEnrolmentRequests: vi.fn(),
  submitEnrolmentRequest: vi.fn(),
  withdrawEnrolmentRequest: vi.fn(),
}));

vi.mock("../../lib/client-auth", () => ({
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../lib/enrolment-client", () => enrolmentApi);

import EnrolPage from "./page";

const buyer = {
  uid: "buyer-1",
  email: "alex@example.test",
  displayName: "Alex Adult",
  role: "shopper" as const,
};

beforeEach(() => {
  authState.status = "signed-in";
  authState.session = buyer;
  enrolmentApi.listMyEnrolmentRequests.mockResolvedValue([]);
  enrolmentApi.submitEnrolmentRequest.mockResolvedValue({
    enrolmentRequestId: "enrolment-1",
    status: "submitted",
    submittedAt: "2026-09-06T10:00:00.000Z",
  });
  enrolmentApi.withdrawEnrolmentRequest.mockResolvedValue({
    enrolmentRequestId: "enrolment-1",
    status: "withdrawn",
    submittedAt: "2026-09-06T10:00:00.000Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("enrolment request page", () => {
  it("asks a visitor to sign in before applying", async () => {
    authState.status = "signed-out";
    authState.session = undefined;

    render(<EnrolPage />);

    expect(screen.getByRole("link", { name: /sign in to apply/i })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fenrol",
    );
    expect(enrolmentApi.listMyEnrolmentRequests).not.toHaveBeenCalled();
  });

  it("sends an existing student to their account instead of a second enrolment", async () => {
    authState.session = { ...buyer, role: "adultStudent" };

    render(<EnrolPage />);

    expect(screen.getByRole("heading", { name: /already enrolled/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument();
    expect(enrolmentApi.listMyEnrolmentRequests).not.toHaveBeenCalled();
  });

  /**
   * The acceptance is the whole point of showing the waiver: without it the academy has a request
   * from somebody who never agreed to anything. It is checked last, so a person who accepted and
   * then missed a field is told about the field.
   */
  it("will not send a request until the waiver is accepted", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));

    expect(await screen.findByText(/read and accept the waiver/i)).toBeVisible();
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("shows the club's waiver and sends the version that was on screen", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    expect(screen.getByText(/Acknowledgment of Risks/i)).toBeVisible();
    expect(screen.getByText(/Participants Under 18/i)).toBeVisible();

    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    await user.click(screen.getByRole("radio", { name: /Town Adult/ }));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    await waitFor(() => expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledOnce());
    expect(enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0]).toMatchObject({
      waiverAcceptance: { version: enrolmentWaiverTermsVersion, accepted: true },
    });
  });

  it("shows plans only after valid details and requires an adult choice before sending", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);
    await screen.findByLabelText("Full name");
    await user.selectOptions(screen.getByLabelText("Training centre"), "West");
    expect(screen.queryByText("£65 per month")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your date of birth.");
    expect(screen.queryByText("£65 per month")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.getByRole("heading", { name: "Choose your plans" })).toHaveFocus();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.getByText("£65 per month")).toBeVisible();
    expect(screen.queryByText("£85 per month")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Kids|Teens/ })).not.toBeInTheDocument();
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose an available plan for every student",
    );
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: /West Adult/ }));
    await user.click(screen.getByRole("button", { name: /send request/i }));
    await waitFor(() => expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledOnce());
    expect(enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0]).toMatchObject({
      planSelections: { applicant: "west-adult", minors: [] },
    });
  });

  it("submits an adult applying for themselves without empty optional fields", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    await user.click(screen.getByRole("radio", { name: /Town Adult/ }));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    await waitFor(() => expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledOnce());
    const submission = enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0];
    expect(submission).toMatchObject({
      requestId: "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11",
      applicantIsStudent: true,
      applicant: {
        fullName: "Alex Adult",
        dateOfBirth: "1994-04-02",
        email: "alex@example.test",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      minors: [],
    });
    expect(submission.applicant).not.toHaveProperty("emergencyContact");
    expect(submission.applicant).not.toHaveProperty("postalAddress");
    expect(submission.applicant).not.toHaveProperty("membershipNumber");
  });

  it("will not send a request without a phone number the academy can call", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a phone number the academy can reach you on.",
    );
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("refuses to send a guardian request with no child on it", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText(/parent or guardian/i));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Add the child you are enrolling.");
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("carries a guardian and their child in one request", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1990-01-01");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText(/parent or guardian/i));
    await user.click(screen.getByRole("button", { name: /add a child/i }));
    await user.type(
      screen.getByLabelText("Full name", { selector: "#enrol-minor-0-name" }),
      "Robin Minor",
    );
    await user.type(
      screen.getByLabelText("Date of birth", { selector: "#enrol-minor-0-dob" }),
      "2016-05-10",
    );
    await user.click(screen.getByLabelText("Afternoon", { selector: "#enrol-minor-0-afternoon" }));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.queryByRole("radio", { name: /Town Adult/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Town Kids & Teens 1x/ }));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    await waitFor(() => expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledOnce());
    expect(enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0]).toMatchObject({
      applicantIsStudent: false,
      planSelections: { minors: ["town-kids-1x"] },
      minors: [
        {
          fullName: "Robin Minor",
          dateOfBirth: "2016-05-10",
          trainingCenter: "Town",
          trainingTimePreferences: ["afternoon"],
        },
      ],
    });
    expect(
      parseEnrolmentRequestSubmission(
        enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0],
        "2026-09-18",
      ).ok,
    ).toBe(true);
  });

  it("shows an open request instead of the form, with what office asked for", async () => {
    enrolmentApi.listMyEnrolmentRequests.mockResolvedValue([
      {
        enrolmentRequestId: "enrolment-1",
        status: "returned",
        submittedAt: "2026-09-06T10:00:00.000Z",
        reviewNote: "Add a phone number we can reach you on.",
      },
    ]);

    render(<EnrolPage />);

    expect(await screen.findByRole("heading", { name: /sent back to you/i })).toBeVisible();
    expect(screen.getByText(/Add a phone number we can reach you on\./)).toBeVisible();
    expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument();
  });

  it("lets the applicant withdraw an open request", async () => {
    const user = userEvent.setup();
    enrolmentApi.listMyEnrolmentRequests.mockResolvedValue([
      {
        enrolmentRequestId: "enrolment-1",
        status: "submitted",
        submittedAt: "2026-09-06T10:00:00.000Z",
      },
    ]);

    render(<EnrolPage />);

    await user.click(await screen.findByRole("button", { name: /withdraw this request/i }));

    await waitFor(() =>
      expect(enrolmentApi.withdrawEnrolmentRequest).toHaveBeenCalledWith("enrolment-1"),
    );
    // A withdrawn request is no longer open, so the form comes back: withdrawing is how somebody
    // corrects a request they sent by mistake, not a dead end.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue to plans/i })).toBeVisible(),
    );
  });

  it("shows the academy's own message when a second request is refused", async () => {
    const user = userEvent.setup();
    enrolmentApi.submitEnrolmentRequest.mockRejectedValueOnce(
      new Error("You already have a request waiting for the academy to review"),
    );
    render(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toBeVisible());
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    await user.click(screen.getByRole("radio", { name: /Town Adult/ }));
    await user.click(screen.getByRole("button", { name: /send request to the academy/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have a request waiting for the academy to review",
    );
  });

  it("still offers the form when the request list cannot be read", async () => {
    enrolmentApi.listMyEnrolmentRequests.mockRejectedValue(new Error("offline"));

    render(<EnrolPage />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /could not check whether you already have a request open/i,
    );
    expect(screen.getByRole("button", { name: /continue to plans/i })).toBeVisible();
  });

  /**
   * ── T001V2 ────────────────────────────────────────────────────────────────────────────────
   *
   * El prellenado es una cortesia, no un valor que el formulario deba defender. Antes de esta
   * fila, el efecto llevaba `form.email.length` y `form.fullName.length` en su propio array de
   * dependencias: al borrar el ultimo caracter la longitud pasaba a 0, el efecto se volvia a
   * ejecutar y reescribia el valor de la sesion. Borrar el campo entero era imposible.
   */
  it("lets the applicant empty the prefilled name and leaves it empty", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    const name = await screen.findByLabelText("Full name");
    await waitFor(() => expect(name).toHaveValue("Alex Adult"));

    await user.clear(name);

    expect(name).toHaveValue("");
    // Un re-render provocado por otro campo es lo que resucitaba el valor: el efecto se volvia a
    // ejecutar porque la longitud habia cambiado. Se escribe en otro campo a proposito.
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    expect(name).toHaveValue("");
  });

  it("lets the applicant empty the prefilled email and leaves it empty", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    const email = await screen.findByLabelText("Email");
    await waitFor(() => expect(email).toHaveValue("alex@example.test"));

    await user.clear(email);

    expect(email).toHaveValue("");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    expect(email).toHaveValue("");
  });

  /**
   * Borrar un caracter a la vez recorre la longitud 1 -> 0, que es exactamente el borde donde
   * fallaba. Un `clear()` salta ese camino de un golpe, asi que se comprueba tambien tecla a
   * tecla: si alguien reintrodujera la condicion, este es el caso que la pilla.
   */
  it("survives deleting the last character, not only a bulk clear", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);

    const name = await screen.findByLabelText("Full name");
    await waitFor(() => expect(name).toHaveValue("Alex Adult"));

    await user.click(name);
    await user.keyboard("{End}");
    for (let index = 0; index < "Alex Adult".length; index += 1) {
      await user.keyboard("{Backspace}");
    }

    expect(name).toHaveValue("");
  });

  /**
   * El prellenado sigue siendo util: lo que cambia es que se siembra una sola vez. Una sesion que
   * llega tarde -el caso real, porque el token se resuelve despues del primer render- tiene que
   * seguir rellenando los dos campos.
   */
  it("still prefills once when the session arrives after the first render", async () => {
    authState.status = "loading";
    authState.session = undefined;
    const view = render(<EnrolPage />);

    authState.status = "signed-in";
    authState.session = buyer;
    view.rerender(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Full name")).toHaveValue("Alex Adult"));
    expect(screen.getByLabelText("Email")).toHaveValue("alex@example.test");
  });

  /**
   * Y una vez sembrado no se vuelve a sembrar, ni siquiera cuando la sesion se refresca con el
   * mismo valor. Ese refresco es lo que reescribiria el campo que el solicitante acaba de vaciar.
   */
  it("does not re-seed an emptied field when the session refreshes unchanged", async () => {
    const user = userEvent.setup();
    const view = render(<EnrolPage />);

    const email = await screen.findByLabelText("Email");
    await waitFor(() => expect(email).toHaveValue("alex@example.test"));
    await user.clear(email);

    authState.session = { ...buyer };
    view.rerender(<EnrolPage />);

    await waitFor(() => expect(screen.getByLabelText("Phone (required)")).toBeVisible());
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });
});

describe("enrolment steps", () => {
  async function fillAdult(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByLabelText("Full name");
    await user.type(screen.getByLabelText("Date of birth"), "1994-04-02");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText("Evening"));
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
  }

  it("preserves details and choices on back, then resets a choice when the centre changes", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);
    await fillAdult(user);
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    await user.click(screen.getByRole("radio", { name: /Town Adult/ }));
    await user.click(screen.getByRole("button", { name: /back to details/i }));
    expect(screen.getByLabelText("Phone (required)")).toHaveValue("07700900123");
    expect(
      screen.getByRole("checkbox", { name: /read and understand this waiver/i }),
    ).toBeChecked();
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.getByRole("radio", { name: /Town Adult/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /back to details/i }));
    await user.selectOptions(screen.getByLabelText("Training centre"), "West");
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.queryByRole("radio", { name: /Town Adult/ })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked),
    ).toBe(true);
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
  });

  it("offers each child plans for their own centre and age and waits for all choices", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);
    await screen.findByLabelText("Full name");
    await user.type(screen.getByLabelText("Date of birth"), "1990-01-01");
    await user.type(screen.getByLabelText("Phone (required)"), "07700900123");
    await user.click(screen.getByLabelText(/parent or guardian/i));
    const children = [
      { name: "Town Child", dob: "2018-05-10", centre: "Town", plan: "Town Kids & Teens 1x" },
      { name: "West Teen", dob: "2011-05-10", centre: "West", plan: "West Teens single class" },
    ];
    for (const [index, child] of children.entries()) {
      await user.click(screen.getByRole("button", { name: /add a child/i }));
      const fields = within(screen.getByRole("group", { name: `Child ${index + 1}` }));
      await user.type(fields.getByLabelText("Full name"), child.name);
      await user.type(fields.getByLabelText("Date of birth"), child.dob);
      await user.selectOptions(fields.getByLabelText("Training centre"), child.centre);
      await user.click(fields.getByLabelText("Afternoon"));
    }
    await user.click(screen.getByRole("checkbox", { name: /read and understand this waiver/i }));
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    const town = within(screen.getByRole("group", { name: "Town Child · Town" }));
    const west = within(screen.getByRole("group", { name: "West Teen · West" }));
    expect(town.getAllByRole("radio")).toHaveLength(2);
    expect(west.getAllByRole("radio")).toHaveLength(2);
    expect(west.queryByRole("radio", { name: /West Kids/ })).not.toBeInTheDocument();
    await user.click(town.getByRole("radio", { name: /Town Kids & Teens 1x/ }));
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
    await user.click(west.getByRole("radio", { name: /West Teens single class/ }));
    await user.click(screen.getByRole("button", { name: /send request/i }));
    await waitFor(() => expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledOnce());
    const submission = enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0];
    expect(submission.planSelections).toEqual({ minors: ["town-kids-1x", "west-teens-payg"] });
    expect(parseEnrolmentRequestSubmission(submission, "2026-09-18").ok).toBe(true);
    expect(await screen.findByRole("heading", { name: "Waiting for the academy" })).toBeVisible();
  });

  it("keeps the selected plan and request ID after failure and prevents duplicate sends", async () => {
    const user = userEvent.setup();
    enrolmentApi.submitEnrolmentRequest.mockRejectedValueOnce(new Error("Try again"));
    render(<EnrolPage />);
    await fillAdult(user);
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    await user.click(screen.getByRole("radio", { name: /Town Adult/ }));
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(screen.getByRole("radio", { name: /Town Adult/ })).toBeChecked();
    const firstSubmission = enrolmentApi.submitEnrolmentRequest.mock.calls[0]?.[0];
    let complete: () => void = () => undefined;
    enrolmentApi.submitEnrolmentRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () =>
            resolve({
              enrolmentRequestId: "enrolment-1",
              status: "submitted",
              submittedAt: "2026-09-18T10:00:00.000Z",
            });
        }),
    );
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(screen.getByRole("button", { name: /sending request/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /back to details/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /sending request/i }));
    expect(enrolmentApi.submitEnrolmentRequest).toHaveBeenCalledTimes(2);
    expect(enrolmentApi.submitEnrolmentRequest.mock.calls[1]?.[0]).toEqual(firstSubmission);
    complete();
    expect(await screen.findByRole("heading", { name: "Waiting for the academy" })).toBeVisible();
  });

  it("validates partial contacts, partial addresses and age before showing plans", async () => {
    const user = userEvent.setup();
    render(<EnrolPage />);
    await fillAdult(user);
    await user.type(screen.getByLabelText("Name", { exact: true }), "Contact");
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Complete the emergency contact");
    await user.clear(screen.getByLabelText("Name", { exact: true }));
    await user.type(screen.getByLabelText("Post code"), "JE2 4WW");
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter both the address and the post code");
    await user.clear(screen.getByLabelText("Post code"));
    await user.clear(screen.getByLabelText("Date of birth"));
    await user.type(screen.getByLabelText("Date of birth"), "2020-01-01");
    await user.click(screen.getByRole("button", { name: /continue to plans/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("applicants must be 18 or over");
    expect(screen.queryByRole("heading", { name: "Choose your plans" })).not.toBeInTheDocument();
    expect(enrolmentApi.submitEnrolmentRequest).not.toHaveBeenCalled();
  });
});
