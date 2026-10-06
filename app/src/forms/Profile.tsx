// The questionnaire that decides which pages apply.
import type { Session } from '../app/store';
import { QUESTIONS, type Question } from './pages';

export function ProfilePage({ session, onDone }: { session: Session; onDone: () => void }) {
  const common = QUESTIONS.filter((q) => !q.advanced);
  const advanced = QUESTIONS.filter((q) => q.advanced);
  // the collapsed questions are optional (unanswered counts as "no"), so only the visible ones are counted
  const answered = common.filter((q) => q.id in session.profile).length;
  const answeredAdvanced = advanced.filter((q) => q.id in session.profile).length;
  return (
    <div className="profile">
      <h1>Cuéntenos sobre su 2025</h1>
      <p className="lede">
        Sus respuestas deciden qué secciones necesita diligenciar. Puede cambiarlas cuando quiera; lo que ya haya escrito no se
        pierde.
      </p>
      <QuestionList qs={common} session={session} />
      <details className="advanced" open={advanced.some((q) => session.profile[q.id])}>
        <summary>
          Situaciones menos comunes{' '}
          <span className="muted">
            (opcional{answeredAdvanced ? `, ${answeredAdvanced} respondidas` : '; si no las abre, cuentan como «No»'})
          </span>
        </summary>
        <QuestionList qs={advanced} session={session} />
      </details>
      <div className="actions">
        <button type="button" className="primary" onClick={onDone}>
          Continuar
        </button>
        <span className="muted">
          {answered} de {common.length} preguntas respondidas
        </span>
      </div>
    </div>
  );
}

function QuestionList({ qs, session }: { qs: Question[]; session: Session }) {
  return (
    <ul className="questions">
      {qs.map((q) => {
        const v = session.profile[q.id];
        return (
          <li key={q.id} className="question">
            <div>
              <span id={`q-${q.id}`} className="q-text">
                {q.text}
              </span>
              {q.hint && <span className="q-hint">{q.hint}</span>}
            </div>
            <div className="seg" role="radiogroup" aria-labelledby={`q-${q.id}`}>
              <button type="button" role="radio" aria-checked={v === true} className={v === true ? 'on' : ''} onClick={() => session.setAnswer(q.id, v === true ? null : true)}>
                Sí
              </button>
              <button type="button" role="radio" aria-checked={v === false} className={v === false ? 'on' : ''} onClick={() => session.setAnswer(q.id, v === false ? null : false)}>
                No
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
