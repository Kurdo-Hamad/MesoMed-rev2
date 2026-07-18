/**
 * Layer-b resource-ownership checks for scheduling commands (§3.6): the
 * kernel role guard has already passed; these bind the session to the
 * specific doctor-location it may manage.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import type { DbExecutor } from "@mesomed/db/modules/scheduling";
import { AppError } from "../../kernel/errors.js";
import type { Session } from "../../kernel/context.js";
import { getDoctorProfileIdForUser } from "../directory/queries/doctor-profile-refs.js";
import { getDoctorLocation, isSecretaryAssigned } from "./queries/schedule-inputs.js";

/**
 * Admin: any doctor-location. Doctor: only their own. Secretary (when
 * allowed): only where actively assigned. Throws NOT_FOUND for a missing
 * row and FORBIDDEN for a real one the session may not manage.
 */
export async function assertCanManageDoctorLocation(
  db: DbExecutor,
  session: Session,
  doctorLocationId: string,
  options: { allowSecretary?: boolean } = {},
): Promise<void> {
  const doctorLocation = await getDoctorLocation(db, doctorLocationId);
  if (!doctorLocation) throw new AppError(ErrorCode.NOT_FOUND, "Doctor location not found");

  if (session.roles.includes("admin")) return;

  if (session.roles.includes("doctor")) {
    const doctorProfileId = await getDoctorProfileIdForUser(db, session.userId);
    if (doctorProfileId !== null && doctorProfileId === doctorLocation.doctorProfileId) return;
  }

  if (options.allowSecretary === true && session.roles.includes("secretary")) {
    if (await isSecretaryAssigned(db, session.userId, doctorLocationId)) return;
  }

  throw new AppError(ErrorCode.FORBIDDEN, "Not authorized for this doctor location");
}
